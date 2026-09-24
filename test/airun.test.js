import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationError, ConflictError } from '../src/lib/errors.js';
import { appendRecord } from '../src/lib/projectRecords.js';
import {
  OPSX_COMMANDS,
  launch,
  getJob,
  listJobsFor,
  resetJobs,
  killAllRunning,
} from '../src/services/aiRunService.js';

/** 测试隔离数据目录（登记表）；必须在 launch 校验前设置 */
const dataDir = join(tmpdir(), `airun-data-${process.pid}`);
process.env.SPEC_PLATFORM_DATA_DIR = dataDir;

/** 假 claude 子进程：可手动发 stdout/stderr/close/error */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

let lastSpawn; // {cmd, args, options}
function spawnSpy(child) {
  return (cmd, args, options) => {
    lastSpawn = { cmd, args, options };
    return child;
  };
}

const createdDirs = [];

/** 建一个"平台登记过的" openspec 项目目录，返回 realpath 归一后的路径 */
async function makeRegisteredProject(name = 'demo') {
  const dir = await mkdtemp(join(tmpdir(), `airun-project-${name}-`));
  createdDirs.push(dir);
  await mkdir(join(dir, 'openspec'));
  await writeFile(join(dir, 'openspec', 'config.yaml'), 'schema: spec-large-self\n');
  await appendRecord({
    name,
    path: dir,
    mode: 'spec-large-self',
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
  });
  return realpath(dir); // macOS 下 /var → /private/var，服务内部同样归一
}

let projectDir; // 默认已登记项目（realpath 形态）

test.before(async () => {
  await mkdir(dataDir, { recursive: true });
});

test.beforeEach(async () => {
  resetJobs();
  projectDir = await makeRegisteredProject();
});

test.afterEach(() => {
  resetJobs(); // 清掉未 close 的假 child 对应的超时定时器
});

test.after(async () => {
  await Promise.all(
    [...createdDirs, dataDir].map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

test('白名单包含全部 11 个 opsx 命令', () => {
  assert.equal(OPSX_COMMANDS.size, 11);
  for (const cmd of [
    'propose', 'apply', 'archive', 'bulk-archive', 'continue',
    'explore', 'ff', 'new', 'onboard', 'sync', 'verify',
  ]) {
    assert.ok(OPSX_COMMANDS.has(cmd), `缺少 ${cmd}`);
  }
});

test('launch 拒绝未知命令 / 相对路径 / 超长输入', async () => {
  await assert.rejects(
    launch(projectDir, 'rm-rf', ''),
    (err) => err instanceof ValidationError && /白名单/.test(err.message),
  );
  await assert.rejects(
    launch('relative/path', 'propose', ''),
    (err) => err instanceof ValidationError && /绝对路径/.test(err.message),
  );
  await assert.rejects(
    launch(projectDir, 'propose', 'x'.repeat(4001)),
    (err) => err instanceof ValidationError && /4000/.test(err.message),
  );
});

test('launch 拒绝未登记目录与缺少 openspec/config.yaml 的目录', async () => {
  // 结构齐全但没在平台登记
  const stranger = await mkdtemp(join(tmpdir(), 'airun-stranger-'));
  createdDirs.push(stranger);
  await mkdir(join(stranger, 'openspec'));
  await writeFile(join(stranger, 'openspec', 'config.yaml'), 'schema: x\n');
  await assert.rejects(
    launch(stranger, 'propose', ''),
    (err) => err instanceof ValidationError && /未在平台登记/.test(err.message),
  );
  // 已登记但没有 config.yaml
  const bare = await mkdtemp(join(tmpdir(), 'airun-bare-'));
  createdDirs.push(bare);
  await mkdir(join(bare, 'openspec'));
  await appendRecord({ name: 'bare', path: bare, mode: 'm', schemaVersion: 2, createdAt: '' });
  await assert.rejects(
    launch(bare, 'propose', ''),
    (err) => err instanceof ValidationError && /config\.yaml/.test(err.message),
  );
});

test('launch 以 claude -p 斜杠命令启动：权限旗标收紧，git 危险子命令被拒', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'propose', 'add-foo 加个功能', {
    spawnFn: spawnSpy(child),
  });
  assert.equal(lastSpawn.cmd, 'claude');
  assert.equal(lastSpawn.args[0], '-p');
  assert.equal(lastSpawn.args[1], '/opsx:propose add-foo 加个功能');
  assert.ok(lastSpawn.args.includes('--permission-mode'));
  assert.ok(lastSpawn.args.includes('acceptEdits'));
  assert.ok(!lastSpawn.args.some((a) => a.includes('dangerously-skip')));
  // 不再放开全量 git；显式拒绝 config/push/remote/commit
  assert.ok(!lastSpawn.args.includes('Bash(git:*)'));
  const disallowIdx = lastSpawn.args.indexOf('--disallowedTools');
  assert.ok(disallowIdx > -1);
  const disallowed = lastSpawn.args.slice(disallowIdx + 1);
  for (const banned of [
    'Bash(git config:*)', 'Bash(git push:*)', 'Bash(git remote:*)', 'Bash(git commit:*)',
  ]) {
    assert.ok(disallowed.includes(banned), `缺少拒绝项 ${banned}`);
  }
  assert.equal(lastSpawn.options.cwd, projectDir);
  assert.equal(lastSpawn.options.detached, true); // 超时/退出可整进程组杀
  assert.deepEqual(lastSpawn.options.stdio, ['ignore', 'pipe', 'pipe']); // stdin 关闭：claude 不等 3s 警告
  assert.equal(job.status, 'running');
  assert.equal(job.command, 'propose');
});

test('stdout/stderr 追加进 output，close(0) → done', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'explore', '', { spawnFn: spawnSpy(child) });
  child.stdout.emit('data', Buffer.from('第一段\n'));
  child.stderr.emit('data', Buffer.from('警告\n'));
  child.emit('close', 0);
  const after = getJob(job.id);
  assert.equal(after.status, 'done');
  assert.equal(after.exitCode, 0);
  assert.ok(after.finishedAt);
  assert.match(after.output, /第一段/);
  assert.match(after.output, /警告/);
});

test('多字节 UTF-8 被 chunk 切断也不产生乱码', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'explore', '', { spawnFn: spawnSpy(child) });
  const bytes = Buffer.from('汉字输出', 'utf8'); // 12 字节，每字 3 字节
  child.stdout.emit('data', bytes.subarray(0, 4)); // "汉" + "字"的第 1 字节
  child.stdout.emit('data', bytes.subarray(4));
  child.emit('close', 0);
  assert.equal(getJob(job.id).output, '汉字输出');
});

test('close 非零 → failed 并记录退出码', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'apply', 'add-foo', { spawnFn: spawnSpy(child) });
  child.emit('close', 2);
  const after = getJob(job.id);
  assert.equal(after.status, 'failed');
  assert.equal(after.exitCode, 2);
});

test('spawn error（claude 不可用）→ failed 带环境错误信息', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'propose', '', { spawnFn: spawnSpy(child) });
  child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
  const after = getJob(job.id);
  assert.equal(after.status, 'failed');
  assert.match(after.error, /claude/);
});

test('同项目已有运行中任务时 launch → ConflictError（realpath 归一后判定）', async () => {
  await launch(projectDir, 'propose', '', { spawnFn: spawnSpy(fakeChild()) });
  // 同一目录的不同字符串写法（尾缀 /./）也视为同一项目
  await assert.rejects(
    launch(`${projectDir}/./`, 'apply', '', { spawnFn: spawnSpy(fakeChild()) }),
    (err) => err instanceof ConflictError && /该项目已有/.test(err.message),
  );
});

test('全局并发达到上限时 launch → ConflictError', async () => {
  const other = await makeRegisteredProject('second');
  const third = await makeRegisteredProject('third');
  await launch(projectDir, 'propose', '', { spawnFn: spawnSpy(fakeChild()) });
  await launch(other, 'propose', '', { spawnFn: spawnSpy(fakeChild()) });
  await assert.rejects(
    launch(third, 'propose', '', { spawnFn: spawnSpy(fakeChild()) }),
    (err) => err instanceof ConflictError && /上限/.test(err.message),
  );
});

test('getJob 增量输出：offset 之后才返回，nextOffset 递进；负 offset 视为 0', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'explore', '', { spawnFn: spawnSpy(child) });
  child.stdout.emit('data', Buffer.from('AAAA'));
  const first = getJob(job.id, 0);
  assert.equal(first.output, 'AAAA');
  assert.equal(first.nextOffset, 4);
  child.stdout.emit('data', Buffer.from('BBBB'));
  const second = getJob(job.id, first.nextOffset);
  assert.equal(second.output, 'BBBB');
  assert.equal(second.nextOffset, 8);
  assert.equal(getJob(job.id, -5).output, 'AAAABBBB');
  assert.equal(getJob('no-such-id'), undefined);
});

test('输出超限保尾：droppedChars 单调递增，落后 offset 得到 gapChars', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'explore', '', { spawnFn: spawnSpy(child) });
  child.stdout.emit('data', Buffer.from('x'.repeat(1_000_100)));
  const after = getJob(job.id, 0);
  assert.equal(after.output.length, 500_000); // 保尾部一半
  assert.equal(after.droppedChars, 500_100);
  assert.equal(after.gapChars, 500_100); // offset=0 落后于已丢弃区
  assert.equal(after.nextOffset, 1_000_100);
  // 用 nextOffset 继续增量拉取则无缺口
  const tail = getJob(job.id, after.nextOffset);
  assert.equal(tail.output, '');
  assert.equal(tail.gapChars, 0);
});

test('listJobsFor 只返回该项目的任务（不含 output/input 大字段）', async () => {
  const child = fakeChild();
  await launch(projectDir, 'propose', '敏感输入', { spawnFn: spawnSpy(child) });
  child.emit('close', 0);
  const list = listJobsFor(projectDir);
  assert.equal(list.length, 1);
  assert.equal(list[0].command, 'propose');
  assert.equal(list[0].output, undefined);
  assert.equal(list[0].input, undefined); // 列表接口不回显用户输入
  assert.deepEqual(listJobsFor('/tmp/definitely-not-exists'), []);
});

test('超时 kill 子进程并标记 failed；随后的 error 事件不覆盖判定', async () => {
  const child = fakeChild();
  const job = await launch(projectDir, 'propose', '', {
    spawnFn: spawnSpy(child),
    timeoutMs: 20,
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(child.killed, true);
  child.emit('error', new Error('late error after timeout'));
  const after = getJob(job.id);
  assert.equal(after.status, 'failed');
  assert.match(after.error, /超时/); // 不被迟到 error 覆盖
});

test('killAllRunning 只杀运行中任务，已结束的不受影响', async () => {
  const finishedChild = fakeChild();
  await launch(projectDir, 'propose', '', { spawnFn: spawnSpy(finishedChild) });
  finishedChild.emit('close', 0); // 先完成一个
  assert.equal(listJobsFor(projectDir)[0].status, 'done');

  resetJobs(); // 清掉已完成的，腾出同项目互斥位
  const runningChild = fakeChild();
  await launch(projectDir, 'explore', '', { spawnFn: spawnSpy(runningChild) });
  killAllRunning();
  assert.equal(runningChild.killed, true);
  assert.equal(finishedChild.killed, false); // 已完成的 job 不会再被 kill
});
