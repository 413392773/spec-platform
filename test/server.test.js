import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';

const SOFT_EXAM = '/Users/huahua/IdeaProjects/ai_study/soft-exam';

let server;
let base;
let port;
let emptyDist;

test.before(async () => {
  // 静态资源指向空目录：未构建前端时，非 /api 路由应回 404 JSON
  emptyDist = await mkdtemp(join(tmpdir(), 'spec-platform-empty-dist-'));
  process.env.SPEC_PLATFORM_WEB_DIR = emptyDist;
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  server.close();
  await rm(emptyDist, { recursive: true, force: true });
});

const postJson = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET /api/health 返回统一信封 + openspec 版本', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.ok, true);
  assert.match(body.data.openspecVersion, /\d+\.\d+/);
});

test('GET /api/schemas 返回模式注册表', async () => {
  const body = await (await fetch(`${base}/api/schemas`)).json();
  assert.equal(body.success, true);
  const large = body.data.schemas.find((s) => s.name === 'spec-large-self');
  assert.ok(large);
  assert.equal(large.default, true);
  assert.equal(typeof large.hint, 'string');
});

test('POST /api/projects 缺 name 返回 400 信封', async () => {
  const res = await postJson('/api/projects', {
    path: '/tmp/whatever-http',
    mode: 'spec-large-self',
    context: {},
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.ok(body.error.includes('name'));
});

test('POST /api/projects/run 非白名单命令返回 400', async () => {
  const res = await postJson('/api/projects/run', { path: SOFT_EXAM, args: ['store'] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('POST /api/projects/run 合法命令代理执行成功（soft-exam list）', async () => {
  const res = await postJson('/api/projects/run', { path: SOFT_EXAM, args: ['list'] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.exitCode, 0);
  assert.match(body.data.stdout, /soft-exam-mvp/);
});

test('未知路由返回 404（前端未构建时非 /api 路径也是 404 JSON）', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
  const staticRes = await fetch(`${base}/nope`);
  assert.equal(staticRes.status, 404);
});

test('裸 /api（无子路径）返回 404 JSON，不落静态分支', async () => {
  const res = await fetch(`${base}/api`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('非回环 Host 头返回 421（防 DNS rebinding）', async () => {
  // fetch 不允许改 Host 头，用原始 socket 构造
  const payload =
    'GET /api/health HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n';
  const response = await new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1', () => sock.end(payload));
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
    });
    sock.on('close', () => resolve(buf));
    sock.on('error', reject);
  });
  assert.match(response, /HTTP\/1\.1 421/);
});

test('POST 非 application/json 的 Content-Type 返回 400（防 CSRF 简单请求）', async () => {
  const res = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ name: 'x' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.error, /Content-Type/);
});

test('POST /api/projects 拒绝根目录 path="/"（防误在 / 上 git init）', async () => {
  const res = await postJson('/api/projects', {
    name: 'x',
    path: '/',
    mode: 'spec-large-self',
    context: { positioning: 'a', techStack: 'b' },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.error, /根目录/);
});

test('POST /api/projects/airun 非白名单命令返回 400', async () => {
  const res = await postJson('/api/projects/airun', {
    path: SOFT_EXAM,
    command: 'rm-rf',
    input: '',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /白名单/);
});

test('POST /api/projects/airun 非 openspec 项目路径返回 400', async () => {
  const res = await postJson('/api/projects/airun', {
    path: '/tmp',
    command: 'propose',
    input: '',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('GET /api/airun/<未知id> 返回 404', async () => {
  const res = await fetch(`${base}/api/airun/no-such-id`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('GET /api/projects/airun 缺 path 参数 400；带 path 返回空列表', async () => {
  const bad = await fetch(`${base}/api/projects/airun`);
  assert.equal(bad.status, 400);
  const ok = await fetch(`${base}/api/projects/airun?path=${encodeURIComponent('/tmp/other')}`);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(body.data.jobs, []);
});
