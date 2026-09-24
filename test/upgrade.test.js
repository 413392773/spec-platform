import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EventEmitter from 'node:events';
import YAML from 'yaml';
import { ValidationError, ConflictError, EnvError } from '../src/lib/errors.js';
import { appendRecord, readRecords, updateRecord } from '../src/lib/projectRecords.js';
import { previewUpgrade, applyUpgrade } from '../src/services/upgradeService.js';
import { launch, resetJobs } from '../src/services/aiRunService.js';

// ── 隔离世界：模板目录 + 数据目录都在 tmp ──
const worldDir = join(tmpdir(), `upgrade-world-${process.pid}`);
const templatesDir = join(worldDir, 'templates');
process.env.SPEC_PLATFORM_TEMPLATES_DIR = templatesDir;
process.env.SPEC_PLATFORM_DATA_DIR = join(worldDir, 'data');

// v2 母本内容（也是留档 base）
const V2_FILES = {
  'schema.yaml': 'version: 2\n',
  'config.rules.yaml': 'rules:\n  proposal:\n    - master-r1\n    - master-r2\n',
  'templates/proposal.md': 'v2 提案模板\n共同行\n',
  'templates/design.md': 'v2 设计模板\n',
  'templates/tasks.md': 'line1\nline2\nline3\n',
  'templates/removed-in-v3.md': 'v3 里被平台删掉的文件\n',
};
// v3 母本：proposal 首行改（与用户改撞车→冲突）、tasks 尾部加行（与用户头部加行→干净合并）、
// design 未动（用户改过→保留我的）、schema/config.rules 平台单边更新、新增 added-in-v3、删 removed-in-v3
const V3_FILES = {
  'schema.yaml': 'version: 3\n',
  'config.rules.yaml': 'rules:\n  proposal:\n    - master-r1\n    - master-r3-new\n',
  'templates/proposal.md': 'v3 提案模板\n共同行\n新增风险小节\n',
  'templates/design.md': 'v2 设计模板\n',
  'templates/tasks.md': 'line1\nline2\nline3\nline4-v3\n',
  'templates/added-in-v3.md': 'v3 新增文件\n',
  'templates/both-new.md': '母本 v3 也新增了这个文件\n',
};

async function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content);
  }
}

/** 建模板世界：registry(v3) + demo-mode 母本(v3) + versions/demo-mode/v2 留档 */
async function buildTemplates() {
  await mkdir(templatesDir, { recursive: true });
  await writeFile(
    join(templatesDir, 'registry.yaml'),
    'schemas:\n  - name: demo-mode\n    label: 演示\n    hint: h\n    version: 3\n    default: true\n',
  );
  await writeFiles(join(templatesDir, 'demo-mode'), V3_FILES);
  await writeFiles(join(templatesDir, 'versions', 'demo-mode', 'v2'), V2_FILES);
}

/** 建"v2 时创建、用户定制过"的项目并登记 */
async function makeProject(name, { rulesOverride, schemaVersion = 2, extraOurs } = {}) {
  const dir = join(worldDir, `projects-${name}`);
  await writeFiles(join(dir, 'openspec', 'schemas', 'demo-mode'), {
    ...V2_FILES,
    // 用户定制：proposal 首行改（撞车）、design 加备注（单边）、tasks 头部加行（可合并）
    'templates/proposal.md': 'v2 提案模板（用户改过）\n共同行\n',
    'templates/design.md': 'v2 设计模板\n用户备注\n',
    'templates/tasks.md': 'line0-user\nline1\nline2\nline3\n',
    ...extraOurs,
  });
  const rules = rulesOverride ?? { proposal: ['master-r1', 'master-r2', 'user-extra'] };
  await writeFile(
    join(dir, 'openspec', 'config.yaml'),
    '# 由 spec-platform 生成——本文件是 openspec CLI 读取的唯一生效配置\n' +
      YAML.stringify({ schema: 'demo-mode', context: '【项目定位】测试项目\n', rules }),
  );
  await appendRecord({
    name,
    path: dir,
    mode: 'demo-mode',
    schemaVersion,
    createdAt: new Date().toISOString(),
  });
  return dir;
}

let projectDir;

test.before(async () => {
  await mkdir(worldDir, { recursive: true });
  await buildTemplates();
});

test.beforeEach(async () => {
  projectDir = await makeProject(`p${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
});

test.after(async () => {
  await rm(worldDir, { recursive: true, force: true });
});

test('previewUpgrade：v2→v3 逐文件分类正确', async () => {
  const preview = await previewUpgrade(projectDir);
  assert.equal(preview.upgradable, true);
  assert.equal(preview.currentVersion, 2);
  assert.equal(preview.latestVersion, 3);
  const byPath = Object.fromEntries(preview.files.map((f) => [f.path, f.action]));
  assert.equal(byPath['schema.yaml'], 'platform-update');
  assert.equal(byPath['config.rules.yaml'], 'platform-update');
  assert.equal(byPath['templates/proposal.md'], 'conflict');
  assert.equal(byPath['templates/design.md'], 'user-keep');
  assert.equal(byPath['templates/tasks.md'], 'auto-merge');
  assert.equal(byPath['templates/added-in-v3.md'], 'add');
  assert.equal(byPath['templates/removed-in-v3.md'], 'delete');
  // 冲突文件带两边全文（前端二选一预览用）
  const conflict = preview.files.find((f) => f.action === 'conflict');
  assert.match(conflict.ours, /用户改过/);
  assert.match(conflict.theirs, /v3 提案模板/);
});

test('previewUpgrade：未登记项目 / 缺留档 / 已是最新', async () => {
  await assert.rejects(
    previewUpgrade(worldDir), // 存在但没登记
    (err) => err instanceof ValidationError && /未在平台登记/.test(err.message),
  );
  const orphan = await makeProject('orphan', { schemaVersion: 1 }); // 无 v1 留档
  await assert.rejects(
    previewUpgrade(orphan),
    (err) => err instanceof EnvError && /留档/.test(err.message),
  );
  const fresh = await makeProject('fresh', { schemaVersion: 3 });
  const preview = await previewUpgrade(fresh);
  assert.equal(preview.upgradable, false);
  assert.deepEqual(preview.files, []);
});

test('applyUpgrade：冲突未裁决 → ConflictError，不落任何盘', async () => {
  await assert.rejects(
    applyUpgrade(projectDir),
    (err) => err instanceof ConflictError && /未裁决/.test(err.message),
  );
  const proposal = await readFile(
    join(projectDir, 'openspec', 'schemas', 'demo-mode', 'templates', 'proposal.md'),
    'utf8',
  );
  assert.match(proposal, /用户改过/); // 原样未动
});

test('applyUpgrade：裁决 ours → 各文件按分类落盘，config/记录/备份全更新', async () => {
  const result = await applyUpgrade(projectDir, { 'templates/proposal.md': 'ours' });
  assert.equal(result.fromVersion, 2);
  assert.equal(result.toVersion, 3);
  const schemaRoot = join(projectDir, 'openspec', 'schemas', 'demo-mode');
  // 冲突按裁决保留用户版
  assert.match(await readFile(join(schemaRoot, 'templates', 'proposal.md'), 'utf8'), /用户改过/);
  // 干净三方合并：两边改动都在
  const tasks = await readFile(join(schemaRoot, 'templates', 'tasks.md'), 'utf8');
  assert.match(tasks, /line0-user/);
  assert.match(tasks, /line4-v3/);
  // 用户单边改动保留；平台单边更新生效；新增/删除到位
  assert.match(await readFile(join(schemaRoot, 'templates', 'design.md'), 'utf8'), /用户备注/);
  assert.match(await readFile(join(schemaRoot, 'schema.yaml'), 'utf8'), /version: 3/);
  assert.ok(existsSync(join(schemaRoot, 'templates', 'added-in-v3.md')));
  assert.ok(!existsSync(join(schemaRoot, 'templates', 'removed-in-v3.md')));
  // config.yaml：新母本 rules + 反推的用户附加，context 原样
  const config = YAML.parse(await readFile(join(projectDir, 'openspec', 'config.yaml'), 'utf8'));
  assert.deepEqual(config.rules.proposal, ['master-r1', 'master-r3-new', 'user-extra']);
  assert.match(config.context, /测试项目/);
  // 登记表版本推进
  const records = await readRecords();
  assert.equal(records.find((r) => r.path === projectDir).schemaVersion, 3);
  // 备份存在且留有旧 proposal 原文
  assert.ok(existsSync(result.backupDir));
  const backupProposal = await readFile(
    join(result.backupDir, 'openspec', 'schemas', 'demo-mode', 'templates', 'proposal.md'),
    'utf8',
  );
  assert.match(backupProposal, /用户改过/);
});

test('applyUpgrade：裁决 theirs → 冲突文件用母本新版', async () => {
  await applyUpgrade(projectDir, { 'templates/proposal.md': 'theirs' });
  const proposal = await readFile(
    join(projectDir, 'openspec', 'schemas', 'demo-mode', 'templates', 'proposal.md'),
    'utf8',
  );
  assert.equal(proposal, V3_FILES['templates/proposal.md']);
  // 升级完成后 preview → 已是最新
  assert.equal((await previewUpgrade(projectDir)).upgradable, false);
});

test('applyUpgrade：用户整体改写过 rules 时按集合差反推附加项', async () => {
  const replaced = await makeProject('replaced', {
    rulesOverride: { proposal: ['custom-only'] },
  });
  await applyUpgrade(replaced, { 'templates/proposal.md': 'ours' });
  const config = YAML.parse(
    await readFile(join(replaced, 'openspec', 'config.yaml'), 'utf8'),
  );
  assert.deepEqual(config.rules.proposal, ['master-r1', 'master-r3-new', 'custom-only']);
});

test('applyUpgrade：非法裁决值 → ValidationError', async () => {
  await assert.rejects(
    applyUpgrade(projectDir, { 'templates/proposal.md': 'both' }),
    (err) => err instanceof ValidationError && /ours|theirs/.test(err.message),
  );
});

// ── 双评审修复批次的回归用例 ──

test('add/add（base 缺失、两边同名新增不同内容）→ conflict，不再 500', async () => {
  const dir = await makeProject('addadd', {
    extraOurs: { 'templates/both-new.md': '用户也新增了这个文件\n' },
  });
  const preview = await previewUpgrade(dir);
  const bothNew = preview.files.find((f) => f.path === 'templates/both-new.md');
  assert.equal(bothNew.action, 'conflict');
  assert.match(bothNew.ours, /用户也新增/);
  assert.match(bothNew.theirs, /母本 v3 也新增/);
  // 裁决 ours 后可正常落盘（proposal 是默认项目的固有冲突，一并裁决）
  const result = await applyUpgrade(dir, {
    'templates/proposal.md': 'ours',
    'templates/both-new.md': 'ours',
  });
  assert.ok(result.kept.includes('templates/both-new.md'));
});

test('项目 schema 目录内的符号链接 → ValidationError（防沙箱逃逸）', async () => {
  const dir = await makeProject('symlinked');
  symlinkSync(
    '/etc/hosts',
    join(dir, 'openspec', 'schemas', 'demo-mode', 'templates', 'evil.md'),
  );
  await assert.rejects(
    previewUpgrade(dir),
    (err) => err instanceof ValidationError && /符号链接/.test(err.message),
  );
});

test('符号链接目录（整个 templates 指外面）同样被拒', async () => {
  const dir = await makeProject('symdir');
  const schemaRoot = join(dir, 'openspec', 'schemas', 'demo-mode');
  await rm(join(schemaRoot, 'templates'), { recursive: true, force: true });
  symlinkSync('/etc', join(schemaRoot, 'templates'));
  await assert.rejects(
    previewUpgrade(dir),
    (err) => err instanceof ValidationError && /符号链接/.test(err.message),
  );
});

test('config.yaml rules 含 __proto__ 键 → 不崩溃，重建后该键被丢弃', async () => {
  const dir = await makeProject('proto', {
    rulesOverride: { proposal: ['master-r1', 'master-r2', 'user-extra'], ['__proto__']: ['evil'] },
  });
  const result = await applyUpgrade(dir, { 'templates/proposal.md': 'ours' });
  assert.equal(result.toVersion, 3);
  const config = YAML.parse(await readFile(join(dir, 'openspec', 'config.yaml'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(config.rules, '__proto__'), false);
  assert.deepEqual(config.rules.proposal, ['master-r1', 'master-r3-new', 'user-extra']);
});

test('config.yaml 坏 YAML → EnvError 且 fail-fast（schema 文件一个都没动）', async () => {
  const dir = await makeProject('badyaml');
  await writeFile(join(dir, 'openspec', 'config.yaml'), 'rules: [unclosed\n');
  await assert.rejects(
    applyUpgrade(dir, { 'templates/proposal.md': 'ours' }),
    (err) => err instanceof EnvError && /解析失败/.test(err.message),
  );
  const schemaYaml = await readFile(
    join(dir, 'openspec', 'schemas', 'demo-mode', 'schema.yaml'),
    'utf8',
  );
  assert.match(schemaYaml, /version: 2/); // platform-update 也没写盘（fail-fast 在写盘前）
});

test('重建 config.yaml 保留 schema/context/rules 之外的顶层键', async () => {
  const dir = await makeProject('extrakeys');
  const configPath = join(dir, 'openspec', 'config.yaml');
  const doc = YAML.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, YAML.stringify({ ...doc, customTop: 'keep-me' }));
  await applyUpgrade(dir, { 'templates/proposal.md': 'ours' });
  const rebuilt = YAML.parse(await readFile(configPath, 'utf8'));
  assert.equal(rebuilt.customTop, 'keep-me');
});

test('applyUpgrade：已是最新 → ConflictError', async () => {
  const fresh = await makeProject('fresh-apply', { schemaVersion: 3 });
  await assert.rejects(
    applyUpgrade(fresh),
    (err) => err instanceof ConflictError && /已是最新/.test(err.message),
  );
});

test('previewUpgrade：项目缺 schemas 目录 → ValidationError', async () => {
  const dir = join(worldDir, 'projects-noschema');
  await mkdir(dir, { recursive: true });
  await appendRecord({
    name: 'noschema',
    path: dir,
    mode: 'demo-mode',
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
  });
  await assert.rejects(
    previewUpgrade(dir),
    (err) => err instanceof ValidationError && /缺少 openspec/.test(err.message),
  );
});

test('applyUpgrade：resolutions 是数组 → ValidationError', async () => {
  await assert.rejects(
    applyUpgrade(projectDir, []),
    (err) => err instanceof ValidationError && /resolutions 必须/.test(err.message),
  );
});

test('母本 schema.yaml 版本与 registry 不一致 → EnvError', async () => {
  const schemaYaml = join(templatesDir, 'demo-mode', 'schema.yaml');
  await writeFile(schemaYaml, 'version: 99\n');
  try {
    await assert.rejects(
      previewUpgrade(projectDir),
      (err) => err instanceof EnvError && /母本版本不一致/.test(err.message),
    );
  } finally {
    await writeFile(schemaYaml, V3_FILES['schema.yaml']);
  }
});

test('路径不存在 → ValidationError；登记表里的死记录不影响活项目', async () => {
  await appendRecord({
    name: 'ghost',
    path: join(worldDir, 'no-such-ghost-dir'),
    mode: 'demo-mode',
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
  });
  await assert.rejects(
    previewUpgrade(join(worldDir, 'no-such-ghost-dir')),
    (err) => err instanceof ValidationError && /项目路径不存在/.test(err.message),
  );
  // 死记录在列表中 realpath 失败被跳过，活项目照常预览
  const preview = await previewUpgrade(projectDir);
  assert.equal(preview.upgradable, true);
});

test('schema 文件超过大小上限 → ValidationError（防 OOM）', async () => {
  const dir = await makeProject('bigfile');
  await writeFile(
    join(dir, 'openspec', 'schemas', 'demo-mode', 'templates', 'big.md'),
    Buffer.alloc(6 * 1024 * 1024, 0x61),
  );
  await assert.rejects(
    previewUpgrade(dir),
    (err) => err instanceof ValidationError && /过大/.test(err.message),
  );
});

test('项目记录 name 被篡改成非法值 → EnvError（备份目录名防御）', async () => {
  const dir = await makeProject('badname');
  await updateRecord(dir, { name: '../evil' });
  await assert.rejects(
    applyUpgrade(dir, { 'templates/proposal.md': 'ours' }),
    (err) => err instanceof EnvError && /name 非法/.test(err.message),
  );
});

test('同项目有 aiRun 任务运行中 → applyUpgrade ConflictError', async () => {
  const fakeChild = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 999999;
    child.kill = () => {};
    return child;
  };
  await launch(projectDir, 'propose', '', { spawnFn: fakeChild, timeoutMs: 60000 });
  try {
    await assert.rejects(
      applyUpgrade(projectDir, { 'templates/proposal.md': 'ours' }),
      (err) => err instanceof ConflictError && /AI 任务运行中/.test(err.message),
    );
  } finally {
    resetJobs();
  }
});

test('previewUpgrade：已是最新时 summary 为空对象（响应形状一致）', async () => {
  const fresh = await makeProject('fresh-summary', { schemaVersion: 3 });
  const preview = await previewUpgrade(fresh);
  assert.deepEqual(preview.summary, {});
});
