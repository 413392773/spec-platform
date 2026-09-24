import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离记录文件：测试写入独立 data 目录，不污染真实 data/projects.json
process.env.SPEC_PLATFORM_DATA_DIR = mkdtempSync(join(tmpdir(), 'psx-data-'));

const { create, listProjects, rollbackArtifacts } = await import(
  '../src/services/projectService.js'
);
const { ValidationError, ConflictError } = await import('../src/lib/errors.js');

const BASE_FORM = {
  name: 'demo-app',
  mode: 'spec-large-self',
  context: {
    positioning: '集成测试用演示项目',
    techStack: 'Node.js 24 + node:test',
    packageRoot: 'demo',
    conventions: ['所有文档使用简体中文'],
  },
  extraRules: { proposal: ['项目特有规则：提案不超过一页'] },
};

test('create 拒绝缺失 name / 未知 mode / 相对 path', async () => {
  await assert.rejects(
    () => create({ ...BASE_FORM, name: '', path: '/tmp/whatever-x1' }),
    ValidationError,
  );
  await assert.rejects(
    () => create({ ...BASE_FORM, path: '/tmp/whatever-x2', mode: 'nope' }),
    ValidationError,
  );
  await assert.rejects(
    () => create({ ...BASE_FORM, path: 'relative/x' }),
    ValidationError,
  );
});

test('create 拒绝已含 openspec 的路径（冲突）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'psx-conflict-'));
  await mkdir(join(dir, 'openspec'));
  await assert.rejects(() => create({ ...BASE_FORM, path: dir }), ConflictError);
  await rm(dir, { recursive: true, force: true });
});

test('create 完整走五步脚手架并记录 schema 版本', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'psx-parent-'));
  const dir = join(parent, 'demo-app');
  const record = await create({ ...BASE_FORM, path: dir });

  // 步骤1：强制 git
  assert.ok(existsSync(join(dir, '.git')), '应有 .git');
  // 步骤2：openspec init 产物
  assert.ok(existsSync(join(dir, '.claude')), '应有 .claude（--tools claude）');
  // 步骤3：schema 副本关键文件
  assert.ok(existsSync(join(dir, 'openspec/schemas/spec-large-self/schema.yaml')));
  assert.ok(existsSync(join(dir, 'openspec/schemas/spec-large-self/config.rules.yaml')));
  // 步骤4：config.yaml 内容
  const config = await readFile(join(dir, 'openspec/config.yaml'), 'utf8');
  assert.match(config, /schema: spec-large-self/);
  assert.match(config, /集成测试用演示项目/);
  assert.match(config, /Node\.js 24 \+ node:test/);
  assert.match(config, /包根路径 demo/);
  assert.match(config, /所有文档使用简体中文/);
  assert.match(config, /项目特有规则：提案不超过一页/);
  assert.match(config, /非目标（Non-goals）/, '母本默认 rules 应合并进 config');

  // 版本钩子：记录 schemaVersion
  assert.equal(record.mode, 'spec-large-self');
  assert.equal(record.schemaVersion, 2);
  assert.ok(record.createdAt);
  const projects = await listProjects();
  assert.ok(projects.some((p) => p.path === dir && p.schemaVersion === 2));

  await rm(parent, { recursive: true, force: true });
});

test('rollbackArtifacts 只删除登记的产物', async () => {
  const base = await mkdtemp(join(tmpdir(), 'psx-rb-'));
  const keep = join(base, 'keep');
  const del = join(base, 'del');
  await mkdir(keep);
  await mkdir(del);
  await rollbackArtifacts([del]);
  assert.ok(existsSync(keep), '未登记目录不得删除');
  assert.ok(!existsSync(del), '登记目录应删除');
  await rm(base, { recursive: true, force: true });
});
