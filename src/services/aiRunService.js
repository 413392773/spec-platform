import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { ValidationError, ConflictError } from '../lib/errors.js';
import { findRegisteredProject } from '../lib/projectLookup.js';

/** aiRun 白名单 = openspec init 生成的 11 个 /opsx:* 斜杠命令（前端 AiPanel.OPSX_OPTIONS 与之对应） */
export const OPSX_COMMANDS = new Set([
  'propose', 'apply', 'archive', 'bulk-archive', 'continue',
  'explore', 'ff', 'new', 'onboard', 'sync', 'verify',
]);

const MAX_INPUT_CHARS = 4000;
const MAX_OUTPUT_CHARS = 1_000_000; // 超限保尾部一半（中文按 char 计，命名如实）
const KEEP_OUTPUT_CHARS = Math.floor(MAX_OUTPUT_CHARS / 2);
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_JOBS = 2; // 全局并发上限：防烧 API 额度/打满 CPU
const MAX_FINISHED_JOBS = 50; // 完成态 job 保留上限，launch 时顺手淘汰

/**
 * 作用域工具白名单：openspec 全量 + git 只读/暂存子命令 + 常规读写编辑。
 * git config/push/remote/commit 不在允许面（提示词注入的经典升级路径），
 * 并再显式 --disallowedTools 拒绝一层。不使用 dangerously-skip-permissions。
 */
const ALLOWED_TOOLS = [
  'Bash(openspec:*)', 'Bash(git status:*)', 'Bash(git diff:*)',
  'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)',
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
];
const DISALLOWED_TOOLS = [
  'Bash(git config:*)', 'Bash(git push:*)', 'Bash(git remote:*)', 'Bash(git commit:*)',
];

/** id → job。仅在模块内部通过 updateJob 以"新对象替换"方式更新，对外只给冻结快照 */
const jobs = new Map();

/** 测试隔离用：清空全部 job（并撤销各自的超时定时器） */
export function resetJobs() {
  for (const job of jobs.values()) {
    if (job.timer) clearTimeout(job.timer);
  }
  jobs.clear();
}

/** 平台退出前调用：杀掉所有运行中的 claude 进程组，不留带写权限的孤儿 */
export function killAllRunning() {
  for (const job of jobs.values()) {
    if (job.status === 'running' && job.child) killChild(job.child);
  }
}

function killChild(child) {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL'); // detached 进程组整组杀
    else child.kill('SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // 进程已退出，无需处理
    }
  }
}

function updateJob(id, patch) {
  const prev = jobs.get(id);
  if (!prev) return;
  jobs.set(id, { ...prev, ...patch }); // 不可变：整体替换，不原地改
}

function metaSnapshot(job) {
  return Object.freeze({
    id: job.id,
    projectPath: job.projectPath,
    command: job.command,
    input: job.input,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  });
}

/** 列表快照不含 input：列表接口按 path 可查，少回显一份用户输入就少一分泄露面 */
function listSnapshot(job) {
  const { input: _input, ...rest } = metaSnapshot(job);
  return Object.freeze(rest);
}

/**
 * 取 job 快照。offset 为"全流绝对字符位"；服务端截断保尾后若 offset 落后于
 * 已丢弃区，返回 gapChars 提示前端插入截断标记。不存在的 id → undefined（路由层 404）。
 */
export function getJob(id, offset = 0) {
  const job = jobs.get(id);
  if (!job) return undefined;
  const retainedStart = job.droppedChars;
  const requested = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const gapChars = Math.max(0, retainedStart - requested);
  const output = requested >= retainedStart ? job.output.slice(requested - retainedStart) : job.output;
  return Object.freeze({
    ...metaSnapshot(job),
    output,
    gapChars,
    nextOffset: retainedStart + job.output.length,
    droppedChars: job.droppedChars,
  });
}

/** 某项目的 job 元数据列表（新→旧）；path 会做 realpath 归一 */
export function listJobsFor(projectPath) {
  let target = projectPath;
  try {
    target = realpathSync(projectPath);
  } catch {
    return []; // 路径不存在自然没有任务
  }
  return [...jobs.values()]
    .filter((job) => job.projectPath === target)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(listSnapshot);
}

function appendOutput(id, text) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running' || !text) return;
  let output = job.output + text;
  let droppedChars = job.droppedChars;
  if (output.length > MAX_OUTPUT_CHARS) {
    const drop = output.length - KEEP_OUTPUT_CHARS;
    output = output.slice(drop);
    droppedChars += drop;
  }
  updateJob(id, { output, droppedChars });
}

function finish(id, patch) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return; // 超时/错误/close 只允许第一个判定生效
  updateJob(id, { ...patch, finishedAt: new Date().toISOString() });
}

/** 完成态 job 超量淘汰（按 finishedAt 最旧先删） */
function pruneFinished() {
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''));
  const excess = finished.length - MAX_FINISHED_JOBS;
  for (let i = 0; i < excess; i += 1) jobs.delete(finished[i].id);
}

/**
 * launch 前置校验：命令白名单 → input → 路径（realpath 归一 + openspec/config.yaml
 * + 非家目录祖先 + 平台登记表内）→ 并发限制。返回归一后的项目路径。
 */
async function validateLaunch(projectPath, command, input) {
  if (!OPSX_COMMANDS.has(command)) {
    throw new ValidationError(
      `命令不在白名单: ${command}（允许: ${[...OPSX_COMMANDS].join(', ')}）`,
    );
  }
  if (typeof input !== 'string' || input.length > MAX_INPUT_CHARS) {
    throw new ValidationError(`input 必须是字符串且不超过 ${MAX_INPUT_CHARS} 字符`);
  }
  const { realPath } = await findRegisteredProject(projectPath);
  if (!existsSync(join(realPath, 'openspec', 'config.yaml'))) {
    throw new ValidationError(`不是有效的 openspec 项目（缺少 openspec/config.yaml）: ${realPath}`);
  }
  const home = realpathSync(homedir());
  if (realPath === home || home.startsWith(realPath + sep)) {
    throw new ValidationError('不能把家目录或其祖先目录作为项目路径');
  }
  const runningJobs = [...jobs.values()].filter((job) => job.status === 'running');
  if (runningJobs.length >= MAX_CONCURRENT_JOBS) {
    throw new ConflictError(`平台同时运行的 AI 任务已达上限（${MAX_CONCURRENT_JOBS} 个），请稍后再试`);
  }
  if (runningJobs.some((job) => job.projectPath === realPath)) {
    throw new ConflictError('该项目已有 AI 任务运行中，请等它结束');
  }
  return realPath;
}

/** 挂接子进程事件：流式解码追加输出、超时杀进程组、error/close 收敛状态机 */
function wireChild(id, child, timeoutMs) {
  const outDecoder = new StringDecoder('utf8'); // 按字符边界解码，中文不被块切断成乱码
  const errDecoder = new StringDecoder('utf8');
  const timer = setTimeout(() => {
    killChild(child);
    finish(id, {
      status: 'failed',
      exitCode: null,
      error: `AI 任务超时（>${Math.round(timeoutMs / 60000)} 分钟），已终止`,
    });
  }, timeoutMs);
  timer.unref?.(); // 长跑定时器不吊住进程退出（生产期由 HTTP server 保活）
  updateJob(id, { timer, child });

  child.stdout?.on('data', (chunk) => appendOutput(id, outDecoder.write(chunk)));
  child.stderr?.on('data', (chunk) => appendOutput(id, errDecoder.write(chunk)));
  child.on('error', (err) => {
    clearTimeout(timer);
    finish(id, {
      status: 'failed',
      error:
        err.code === 'ENOENT'
          ? 'claude CLI 不可用，请先安装并登录 Claude Code'
          : `claude 进程错误: ${err.message}`,
    });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    appendOutput(id, outDecoder.end());
    appendOutput(id, errDecoder.end());
    finish(id, { status: code === 0 ? 'done' : 'failed', exitCode: code });
  });
}

/**
 * 启动一次 AI 工作流：在项目目录 spawn `claude -p "/opsx:<cmd> <input>"`。
 * 校验失败抛 ValidationError；并发冲突抛 ConflictError。
 * spawnFn/timeoutMs 可注入（测试用）。
 */
export async function launch(projectPath, command, input = '', options = {}) {
  const { spawnFn = nodeSpawn, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const realPath = await validateLaunch(projectPath, command, input);
  pruneFinished();

  const job = {
    id: randomUUID(),
    projectPath: realPath,
    command,
    input: input.trim(),
    status: 'running',
    exitCode: null,
    output: '',
    droppedChars: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    child: null,
    timer: null,
  };
  jobs.set(job.id, job);

  const prompt = job.input ? `/opsx:${command} ${job.input}` : `/opsx:${command}`;
  const args = [
    '-p', prompt,
    '--permission-mode', 'acceptEdits',
    '--output-format', 'text',
    '--allowedTools', ...ALLOWED_TOOLS, // 变长参数放最后，避免吞掉后续旗标
    '--disallowedTools', ...DISALLOWED_TOOLS,
  ];
  // stdin 必须显式关闭：否则 claude -p 会等 3 秒 stdin 并在输出里塞警告
  const child = spawnFn('claude', args, {
    cwd: realPath,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  wireChild(job.id, child, timeoutMs);
  return metaSnapshot(job);
}
