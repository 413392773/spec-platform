import { existsSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import YAML from 'yaml';
import { ValidationError, ConflictError, EnvError } from '../lib/errors.js';
import { runCommand } from '../lib/runCommand.js';
import { appendRecord, readRecords } from '../lib/projectRecords.js';
import {
  getMode,
  getMasterDir,
  getMasterRules,
  getMasterVersion,
} from './registryService.js';
import { run as runOpenspec } from './openspecService.js';

// 与 web/src/validation.js 的 NAME_RE 保持一致：前端管即时提示，这里是权威校验
// （export 供 upgradeService 复验备份目录名）
export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const INIT_TOOLS = 'claude';

function validateForm(form) {
  if (!form || typeof form !== 'object') {
    throw new ValidationError('请求体必须是对象');
  }
  const errors = [];
  if (typeof form.name !== 'string' || !NAME_RE.test(form.name)) {
    errors.push('name 必填且须为 kebab-case（小写字母/数字/中划线）');
  }
  if (typeof form.path !== 'string' || !isAbsolute(form.path) || form.path === '/') {
    errors.push('path 必须是绝对路径（且不能是根目录 /）');
  }
  if (typeof form.mode !== 'string' || form.mode.length === 0) {
    errors.push('mode 必填（见 GET /schemas）');
  }
  const ctx = form.context;
  if (!ctx || typeof ctx !== 'object') {
    errors.push('context 必填（positioning/techStack 等）');
  } else {
    if (typeof ctx.positioning !== 'string' || !ctx.positioning.trim()) {
      errors.push('context.positioning 必填');
    }
    if (typeof ctx.techStack !== 'string' || !ctx.techStack.trim()) {
      errors.push('context.techStack 必填');
    }
    if (ctx.packageRoot !== undefined && typeof ctx.packageRoot !== 'string') {
      errors.push('context.packageRoot 必须是字符串');
    }
    if (
      ctx.conventions !== undefined &&
      (!Array.isArray(ctx.conventions) || ctx.conventions.some((c) => typeof c !== 'string'))
    ) {
      errors.push('context.conventions 必须是字符串数组');
    }
  }
  if (form.extraRules !== undefined) {
    const er = form.extraRules;
    const isRulesShape =
      er &&
      typeof er === 'object' &&
      !Array.isArray(er) &&
      Object.values(er).every(
        (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
      );
    if (!isRulesShape) {
      errors.push('extraRules 必须是 { artifactId: [字符串, ...] } 形状');
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(errors.join('；'));
  }
}

/** 表单 context → config.yaml 的 context 块（小白话术的项目上下文） */
function buildContextText(ctx) {
  const lines = [
    `【项目定位】${ctx.positioning}`,
    `【技术栈】${ctx.techStack}${ctx.packageRoot ? `，包根路径 ${ctx.packageRoot}` : ''}`,
    '【语言】所有文档强制使用简体中文（API、REST 等技术术语可保留英文）。',
    '【动手前确认】每个 artifact 生成前先输出理解、假设、边界，有疑问先问，不要自行脑补需求。',
  ];
  for (const convention of ctx.conventions ?? []) {
    lines.push(`【项目约定】${convention}`);
  }
  return `${lines.join('\n')}\n`;
}

/** 母本默认 rules + 项目特有 extraRules（追加式合并，不修改入参）；upgradeService 复用 */
export function mergeRules(masterRules, extraRules) {
  const merged = {};
  for (const [artifact, rules] of Object.entries(masterRules)) {
    if (artifact === '__proto__') continue; // 防原型 setter 副作用
    merged[artifact] = [...rules];
  }
  for (const [artifact, rules] of Object.entries(extraRules)) {
    if (artifact === '__proto__') continue;
    merged[artifact] = [...(merged[artifact] ?? []), ...rules];
  }
  return merged;
}

function buildConfigYaml(form, masterVersion) {
  const header = [
    '# 由 spec-platform 生成——本文件是 openspec CLI 读取的唯一生效配置',
    `# 模式: ${form.mode}@v${masterVersion}（母本: spec-platform/templates/schemas/${form.mode}/）`,
    '# rules 来源: 母本默认(config.rules.yaml) + 项目特有(extraRules) 合并；母本升级走三方合并',
    '',
  ].join('\n');
  const doc = {
    schema: form.mode,
    context: buildContextText(form.context),
    rules: mergeRules(getMasterRules(form.mode), form.extraRules ?? {}),
  };
  return header + YAML.stringify(doc);
}

/** 按登记清单删除脚手架产物（最深路径优先），未登记的一律不碰 */
export async function rollbackArtifacts(artifacts) {
  const ordered = [...artifacts].sort((a, b) => b.length - a.length);
  for (const artifact of ordered) {
    await rm(artifact, { recursive: true, force: true });
  }
}

/**
 * 五步脚手架（docs/openspec-scaffold-flow.md §3）：
 * git 强制 → openspec init → 复制 schema 母本 → 生成 config.yaml → 验证。
 * 任一步失败：删除本次创建的产物后抛错（fail-fast，不交付半成品）。
 */
export async function create(form) {
  validateForm(form);
  const mode = getMode(form.mode);
  if (!mode) {
    throw new ValidationError(`未知模式: ${form.mode}（见 GET /schemas）`);
  }
  const master = getMasterVersion(form.mode);
  if (!master) {
    throw new ValidationError(`模式 ${form.mode} 无母本目录`);
  }
  if (!master.matchesRegistry) {
    throw new EnvError(
      `母本版本不一致: schema.yaml v${master.version} vs registry v${mode.version}，请先修复母本`,
    );
  }

  const rootPath = form.path;
  if (existsSync(join(rootPath, 'openspec'))) {
    throw new ConflictError(`目标路径已包含 openspec 项目: ${rootPath}`);
  }

  const createdArtifacts = []; // 回滚台账：只删登记过的产物
  // init 之前先记住哪些目录是用户既有的——既有的永远不进台账（回滚只删本次新建的）
  const claudeDirExisted = existsSync(join(rootPath, '.claude'));
  try {
    // ── 步骤1：目录 + 强制 git ──
    const rootExisted = existsSync(rootPath);
    await mkdir(rootPath, { recursive: true });
    if (!rootExisted) createdArtifacts.push(rootPath);
    let git = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], { cwd: rootPath });
    if (git.exitCode !== 0) {
      git = await runCommand('git', ['init', '-b', 'main'], { cwd: rootPath });
      if (git.exitCode !== 0) {
        throw new EnvError(`git init 失败: ${git.stderr.trim()}`);
      }
      createdArtifacts.push(join(rootPath, '.git'));
    }

    // ── 步骤2：openspec init（非交互，必须带 --tools）──
    const init = await runCommand('openspec', ['init', '--tools', INIT_TOOLS], { cwd: rootPath });
    if (init.exitCode !== 0) {
      throw new EnvError(`openspec init 失败: ${(init.stderr || init.stdout).trim()}`);
    }
    createdArtifacts.push(join(rootPath, 'openspec'));
    if (!claudeDirExisted && existsSync(join(rootPath, '.claude'))) {
      createdArtifacts.push(join(rootPath, '.claude'));
    }

    // ── 步骤3：复制 schema 母本 ──
    await cp(getMasterDir(form.mode), join(rootPath, 'openspec', 'schemas', form.mode), {
      recursive: true,
    });

    // ── 步骤4：生成 config.yaml（覆写 init 默认的 spec-driven）──
    await writeFile(join(rootPath, 'openspec', 'config.yaml'), buildConfigYaml(form, master.version));

    // ── 步骤5：验证 ──
    const validated = await runOpenspec(rootPath, ['schema', 'validate', form.mode]);
    if (validated.exitCode !== 0) {
      throw new EnvError(`schema validate 失败: ${(validated.stderr || validated.stdout).trim()}`);
    }
    const doctor = await runOpenspec(rootPath, ['doctor']);
    if (doctor.exitCode !== 0) {
      throw new EnvError(`openspec doctor 失败: ${(doctor.stderr || doctor.stdout).trim()}`);
    }

    // ── 版本钩子：落盘记录（项目 → schema@version）──
    const record = Object.freeze({
      name: form.name,
      path: rootPath,
      mode: form.mode,
      schemaVersion: master.version,
      createdAt: new Date().toISOString(),
    });
    await appendRecord(record);
    return record;
  } catch (err) {
    await rollbackArtifacts(createdArtifacts);
    throw err;
  }
}

export async function listProjects() {
  return readRecords();
}
