import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

const SOFT_EXAM = '/Users/huahua/IdeaProjects/ai_study/soft-exam';

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const postJson = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET /health 返回统一信封 + openspec 版本', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.ok, true);
  assert.match(body.data.openspecVersion, /\d+\.\d+/);
});

test('GET /schemas 返回模式注册表', async () => {
  const body = await (await fetch(`${base}/schemas`)).json();
  assert.equal(body.success, true);
  const large = body.data.schemas.find((s) => s.name === 'spec-large-self');
  assert.ok(large);
  assert.equal(large.default, true);
  assert.equal(typeof large.hint, 'string');
});

test('POST /projects 缺 name 返回 400 信封', async () => {
  const res = await postJson('/projects', {
    path: '/tmp/whatever-http',
    mode: 'spec-large-self',
    context: {},
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.ok(body.error.includes('name'));
});

test('POST /projects/run 非白名单命令返回 400', async () => {
  const res = await postJson('/projects/run', { path: SOFT_EXAM, args: ['store'] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('POST /projects/run 合法命令代理执行成功（soft-exam list）', async () => {
  const res = await postJson('/projects/run', { path: SOFT_EXAM, args: ['list'] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.exitCode, 0);
  assert.match(body.data.stdout, /soft-exam-mvp/);
});

test('未知路由返回 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
});
