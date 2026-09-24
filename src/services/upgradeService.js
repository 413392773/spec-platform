import { existsSync, lstatSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import YAML from 'yaml';
import { ValidationError, ConflictError, EnvError } from '../lib/errors.js';
import { getDataDir, getTemplatesDir } from '../lib/paths.js';
import { runCommand } from '../lib/runCommand.js';
import { findRegisteredProject } from '../lib/projectLookup.js';
import { updateRecord } from '../lib/projectRecords.js';
import { getMasterDir, getMasterRules, getMasterVersion } from './registryService.js';
import { mergeRules, NAME_RE } from './projectService.js';
import { listJobsFor } from './aiRunService.js';

/**
 * schema 同步/升级（三方合并）：
 *   base   = templates/schemas/versions/<mode>/v<当前记录版本>/（母本留档）
 *   ours   = 项目 openspec/schemas/<mode>/（可能含用户定制）
 *   theirs = templates/schemas/<mode>/（最新母本）
 * 两边改动不重叠 → git merge-file 自动合并；撞车 → 冲突，由用户二选一（ours/theirs）。
 * 唯一生效配置 openspec/config.yaml 的 rules 块随之重建（新母本 rules + 反推的用户附加项），
 * context 块原样保留。升级前全部受影响文件备份到 data/backups/。
 */

const VALID_RESOLUTIONS = new Set(['ours', 'theirs']);
/** git merge-file 退出码：0=干净，1~125=冲突块数，其余（如 255 打不开文件）=错误 */
const MAX_CONFLICT_EXIT_CODE = 125;
/** 单文件大小上限：升级通道只处理文本模板，超限多半是误放的二进制/异常文件 */
const MAX_SCHEMA_FILE_BYTES = 5 * 1024 * 1024;
/** YAML rules 里具有原型语义的键：一律跳过，防 setter/getter 副作用 */
const DANGEROUS_RULE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** 正在执行升级的项目 realPath（同项目串行，防止并发写盘互踩） */
const upgradingPaths = new Set();

async function listRelFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    // 符号链接也列出：项目侧的会在 buildPlan 被 assertNoSymlink 拒绝，不能静默漏检
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => {
      const parent = entry.parentPath ?? entry.path;
      return join(relative(dir, parent), entry.name).split(sep).join('/');
    });
}

async function readOrNull(filePath) {
  if (!existsSync(filePath)) return null;
  const { size } = statSync(filePath);
  if (size > MAX_SCHEMA_FILE_BYTES) {
    throw new ValidationError(
      `schema 文件过大（超过 ${MAX_SCHEMA_FILE_BYTES / 1024 / 1024}MB 上限）: ${filePath}`,
    );
  }
  return readFile(filePath, 'utf8');
}

/**
 * 升级通道拒绝符号链接：项目 schema 目录内任一路径段是软链即拒，
 * 否则读/写/删会顺着链接逃逸到项目外（预览泄露、覆盖、删除外部文件）。
 * 段不存在即返回（无可逃逸；apply 会重建计划再查一遍）。
 */
function assertNoSymlink(oursDir, rel) {
  let current = oursDir;
  for (const segment of rel.split('/')) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      return;
    }
    if (stats.isSymbolicLink()) {
      throw new ValidationError(
        `项目 schema 目录内存在符号链接：${rel}（升级通道禁止符号链接，请移除后重试）`,
      );
    }
  }
}

/** git merge-file 单文件三方合并：退出码 0=干净，1~125=冲突块数，其余=错误 */
async function threeWayMerge(oursPath, basePath, theirsPath) {
  let exitCode;
  let stdout;
  let stderr;
  try {
    ({ exitCode, stdout, stderr } = await runCommand('git', [
      'merge-file', '-p',
      '-L', '我的修改', '-L', '母本旧版', '-L', '母本新版',
      oursPath, basePath, theirsPath,
    ]));
  } catch {
    throw new EnvError('git 不可用或执行失败（三方合并依赖 git merge-file），请先安装 git');
  }
  if (exitCode === 0) return { clean: true, merged: stdout };
  if (exitCode > 0 && exitCode <= MAX_CONFLICT_EXIT_CODE) return { clean: false };
  throw new EnvError(`git merge-file 失败: ${(stderr || stdout).trim()}`);
}

/** 单文件分类：unchanged / add / platform-update / delete / user-keep / auto-merge / conflict */
async function classifyFile(entry) {
  const { base, ours, theirs, oursPath, basePath, theirsPath } = entry;
  if (ours === theirs) return { ...entry, action: 'unchanged' };
  if (base === null && ours === null) return { ...entry, action: 'add' };
  if (ours === base) {
    return { ...entry, action: theirs === null ? 'delete' : 'platform-update' };
  }
  if (theirs === base) return { ...entry, action: 'user-keep' };
  if (ours === null) return { ...entry, action: 'add' }; // 用户删过而平台又改了 → 当新增补回
  if (theirs === null) return { ...entry, action: 'user-keep' }; // 平台删了但用户改过 → 保用户
  if (base === null) return { ...entry, action: 'conflict' }; // add/add：两边各自新增同名文件 → 交用户裁决
  const merge = await threeWayMerge(oursPath, basePath, theirsPath);
  return merge.clean
    ? { ...entry, action: 'auto-merge', merged: merge.merged }
    : { ...entry, action: 'conflict' };
}

/** 构建升级计划（preview/apply 共用的单一事实来源） */
async function buildPlan(projectPath) {
  const { realPath, record } = await findRegisteredProject(projectPath);
  const mode = record.mode;
  const master = getMasterVersion(mode);
  if (!master) throw new ValidationError(`模式 ${mode} 无母本目录`);
  if (!master.matchesRegistry) {
    throw new EnvError(
      `母本版本不一致: schema.yaml v${master.version} vs registry，请先修复母本`,
    );
  }
  const currentVersion = record.schemaVersion;
  const latestVersion = master.version;
  if (currentVersion === latestVersion) {
    return { upgradable: false, realPath, record, mode, currentVersion, latestVersion, entries: [] };
  }
  const baseDir = join(getTemplatesDir(), 'versions', mode, `v${currentVersion}`);
  if (!existsSync(baseDir)) {
    throw new EnvError(
      `缺少 v${currentVersion} 母本留档（versions/${mode}/v${currentVersion}/），无法三方合并`,
    );
  }
  const oursDir = join(realPath, 'openspec', 'schemas', mode);
  if (!existsSync(oursDir)) {
    throw new ValidationError(`项目缺少 openspec/schemas/${mode} 目录`);
  }
  const theirsDir = getMasterDir(mode);
  const relPaths = [
    ...new Set([
      ...(await listRelFiles(baseDir)),
      ...(await listRelFiles(oursDir)),
      ...(await listRelFiles(theirsDir)),
    ]),
  ].sort();

  const entries = [];
  for (const rel of relPaths) {
    assertNoSymlink(oursDir, rel);
    const oursPath = join(oursDir, rel);
    const basePath = join(baseDir, rel);
    const theirsPath = join(theirsDir, rel);
    entries.push(
      await classifyFile({
        path: rel,
        base: await readOrNull(basePath),
        ours: await readOrNull(oursPath),
        theirs: await readOrNull(theirsPath),
        oursPath,
        basePath,
        theirsPath,
      }),
    );
  }
  return { upgradable: true, realPath, record, mode, currentVersion, latestVersion, baseDir, entries };
}

function toPublicFile(entry) {
  const file = { path: entry.path, action: entry.action };
  if (entry.action === 'conflict') {
    return { ...file, ours: entry.ours, theirs: entry.theirs }; // 二选一预览全文
  }
  return file;
}

/** 升级预览：当前/最新版本 + 逐文件分类清单（unchanged 不列出） */
export async function previewUpgrade(projectPath) {
  const plan = await buildPlan(projectPath);
  if (!plan.upgradable) {
    return {
      upgradable: false,
      mode: plan.mode,
      currentVersion: plan.currentVersion,
      latestVersion: plan.latestVersion,
      files: [],
      summary: {},
    };
  }
  const files = plan.entries
    .filter((entry) => entry.action !== 'unchanged')
    .map(toPublicFile);
  const summary = {};
  for (const file of files) {
    summary[file.action] = (summary[file.action] ?? 0) + 1;
  }
  return {
    upgradable: true,
    mode: plan.mode,
    currentVersion: plan.currentVersion,
    latestVersion: plan.latestVersion,
    files,
    summary,
  };
}

/** 母本 rules 为前缀（追加式合并的性质）→ 后缀即用户附加；被整体改写过 → 集合差兜底 */
function deriveExtraRules(baseRules, currentRules) {
  const extras = {};
  for (const [artifact, list] of Object.entries(currentRules ?? {})) {
    if (DANGEROUS_RULE_KEYS.has(artifact) || !Array.isArray(list)) continue;
    const base = Array.isArray(baseRules?.[artifact]) ? baseRules[artifact] : [];
    const isAppendOnly = base.every((rule, i) => list[i] === rule);
    const extra = isAppendOnly
      ? list.slice(base.length)
      : list.filter((rule) => !base.includes(rule));
    if (extra.length > 0) extras[artifact] = extra;
  }
  return extras;
}

function buildUpgradedConfigYaml(currentDoc, mode, latestVersion, newRules) {
  const header = [
    '# 由 spec-platform 生成——本文件是 openspec CLI 读取的唯一生效配置',
    `# 模式: ${mode}@v${latestVersion}（母本: spec-platform/templates/schemas/${mode}/）`,
    `# rules 来源: 新母本默认(config.rules.yaml) + 项目附加规则；由 schema 升级通道于 ${new Date().toISOString()} 重建`,
    '',
  ].join('\n');
  return header + YAML.stringify({
    ...(currentDoc ?? {}), // 其余顶层键（用户或 CLI 加的）原样保留
    schema: currentDoc?.schema ?? mode,
    context: currentDoc?.context ?? '',
    rules: newRules,
  });
}

/** 备份受影响文件（保留相对结构）+ config.yaml；返回备份目录 */
async function backupAffected(plan, changedEntries) {
  // 防御性复验：备份目录名用到 record.name，创建时已过 NAME_RE，但登记表可能被手改
  if (!NAME_RE.test(plan.record.name)) {
    throw new EnvError(`项目记录 name 非法（应为 kebab-case 小写）: ${plan.record.name}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(getDataDir(), 'backups', `${plan.record.name}-${stamp}`);
  for (const entry of changedEntries) {
    if (entry.ours === null) continue; // 新增文件无原件可备
    const rel = join('openspec', 'schemas', plan.mode, entry.path);
    await mkdir(join(backupDir, dirname(rel)), { recursive: true });
    await writeFile(join(backupDir, rel), entry.ours);
  }
  const configPath = join(plan.realPath, 'openspec', 'config.yaml');
  if (existsSync(configPath)) {
    await mkdir(join(backupDir, 'openspec'), { recursive: true });
    await writeFile(join(backupDir, 'openspec', 'config.yaml'), await readFile(configPath, 'utf8'));
  }
  return backupDir;
}

function validateResolutions(plan, resolutions) {
  const resolved = resolutions ?? {};
  if (typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new ValidationError('resolutions 必须是 { 文件路径: "ours" | "theirs" } 对象');
  }
  const conflicts = plan.entries.filter((entry) => entry.action === 'conflict');
  for (const entry of conflicts) {
    const choice = resolved[entry.path];
    if (choice !== undefined && !VALID_RESOLUTIONS.has(choice)) {
      throw new ValidationError(`冲突文件 ${entry.path} 的裁决必须是 ours（保留我的）或 theirs（用母本新版）`);
    }
  }
  const unresolved = conflicts.filter((entry) => resolved[entry.path] === undefined);
  if (unresolved.length > 0) {
    throw new ConflictError(
      `存在未裁决冲突：${unresolved.map((e) => e.path).join('、')}（每个选 ours 或 theirs）`,
    );
  }
  return resolved;
}

/** 按裁决结果把单个文件落到项目里；返回 written/deleted/kept 之一 */
async function applyEntry(plan, entry, resolutions) {
  const target = join(plan.realPath, 'openspec', 'schemas', plan.mode, entry.path);
  switch (entry.action) {
    case 'platform-update':
    case 'add':
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.theirs);
      return 'written';
    case 'auto-merge':
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.merged);
      return 'written';
    case 'conflict':
      if (resolutions[entry.path] === 'theirs') {
        await writeFile(target, entry.theirs);
        return 'written';
      }
      return 'kept';
    case 'delete':
      await rm(target, { force: true });
      return 'deleted';
    default:
      return 'kept'; // unchanged / user-keep
  }
}

/** 提前读取并解析项目 openspec/config.yaml（fail-fast：坏 YAML 在任何写盘前就拒） */
async function parseProjectConfig(plan) {
  const configPath = join(plan.realPath, 'openspec', 'config.yaml');
  if (!existsSync(configPath)) return null;
  try {
    return YAML.parse(await readFile(configPath, 'utf8'));
  } catch (err) {
    throw new EnvError(`openspec/config.yaml 解析失败，请先手工修复: ${err.message}`);
  }
}

async function rebuildConfigYaml(plan, currentDoc) {
  const configPath = join(plan.realPath, 'openspec', 'config.yaml');
  const baseRulesDoc = await readOrNull(join(plan.baseDir, 'config.rules.yaml'));
  const baseRules = baseRulesDoc ? (YAML.parse(baseRulesDoc)?.rules ?? {}) : {};
  const extras = deriveExtraRules(baseRules, currentDoc?.rules);
  const newRules = mergeRules(getMasterRules(plan.mode), extras);
  await writeFile(configPath, buildUpgradedConfigYaml(currentDoc, plan.mode, plan.latestVersion, newRules));
}

/** 并发准入：同项目有 aiRun 在跑或已有升级在飞 → 拒绝，避免读写互踩 */
function assertUpgradable(plan) {
  if (listJobsFor(plan.realPath).some((job) => job.status === 'running')) {
    throw new ConflictError('该项目有 AI 任务运行中，请等它结束后再升级');
  }
  if (upgradingPaths.has(plan.realPath)) {
    throw new ConflictError('该项目已有升级在执行中，请稍后再试');
  }
}

/**
 * 执行升级：冲突必须全部裁决（否则 ConflictError），config.yaml 坏 YAML / 非法记录名
 * 等错误在任何写盘之前 fail-fast；先备份再落盘，重建 config.yaml rules，
 * 最后把登记表 schemaVersion 推进到新版。
 */
export async function applyUpgrade(projectPath, resolutions) {
  const plan = await buildPlan(projectPath);
  if (!plan.upgradable) {
    throw new ConflictError(`项目已是最新（v${plan.currentVersion}），无需升级`);
  }
  const resolved = validateResolutions(plan, resolutions);
  assertUpgradable(plan);
  const currentDoc = await parseProjectConfig(plan); // fail-fast：写盘前解析
  const changed = plan.entries.filter(
    (entry) => !['unchanged', 'user-keep'].includes(entry.action),
  );

  upgradingPaths.add(plan.realPath);
  try {
    const backupDir = await backupAffected(plan, changed);
    const result = { written: [], deleted: [], kept: [] };
    for (const entry of plan.entries) {
      const bucket = await applyEntry(plan, entry, resolved);
      result[bucket].push(entry.path);
    }
    await rebuildConfigYaml(plan, currentDoc);
    const updated = await updateRecord(plan.record.path, { schemaVersion: plan.latestVersion });
    if (!updated) {
      throw new ConflictError(
        `升级文件已写入，但登记表里找不到该项目记录，版本号未更新——请检查 data/projects.json（备份: ${backupDir}）`,
      );
    }
    return {
      fromVersion: plan.currentVersion,
      toVersion: plan.latestVersion,
      mode: plan.mode,
      ...result,
      backupDir,
    };
  } finally {
    upgradingPaths.delete(plan.realPath);
  }
}
