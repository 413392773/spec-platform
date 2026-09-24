import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { run, ALLOWED_COMMANDS } from '../src/services/openspecService.js';
import { ValidationError } from '../src/lib/errors.js';

const execFileAsync = promisify(execFile);

/** 用真实 openspec init 建最小项目（--tools none 不落 IDE 文件） */
async function makeRealProject() {
  const dir = await mkdtemp(join(tmpdir(), 'opsx-svc-'));
  await execFileAsync('openspec', ['init', '--tools', 'none'], { cwd: dir });
  return dir;
}

test('白名单收录管理命令、排除危险命令', () => {
  for (const banned of ['init', 'store', 'config', 'update']) {
    assert.ok(!ALLOWED_COMMANDS.has(banned), `${banned} 不应在白名单`);
  }
  for (const allowed of ['list', 'doctor', 'schema', 'archive', 'context', 'view']) {
    assert.ok(ALLOWED_COMMANDS.has(allowed), `${allowed} 应在白名单`);
  }
});

test('拒绝白名单外命令', async () => {
  const dir = await makeRealProject();
  await assert.rejects(() => run(dir, ['store', 'list']), ValidationError);
  await assert.rejects(() => run(dir, ['init']), ValidationError);
  await rm(dir, { recursive: true, force: true });
});

test('拒绝相对路径与缺少 openspec 目录的路径', async () => {
  await assert.rejects(() => run('relative/path', ['list']), ValidationError);
  const dir = await mkdtemp(join(tmpdir(), 'opsx-noos-'));
  await assert.rejects(() => run(dir, ['list']), ValidationError);
  await rm(dir, { recursive: true, force: true });
});

test('拒绝空 args 与含非字符串的 args', async () => {
  const dir = await makeRealProject();
  await assert.rejects(() => run(dir, []), ValidationError);
  await assert.rejects(() => run(dir, ['list', 42]), ValidationError);
  await assert.rejects(() => run(dir, 'list'), ValidationError);
  await rm(dir, { recursive: true, force: true });
});

test('对真实项目执行 openspec list 返回结构化结果', async () => {
  const dir = await makeRealProject();
  const result = await run(dir, ['list']);
  assert.equal(result.exitCode, 0);
  assert.equal(typeof result.stdout, 'string');
  assert.equal(typeof result.stderr, 'string');
  await rm(dir, { recursive: true, force: true });
});
