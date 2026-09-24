import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import { resolveStaticPath, contentTypeFor } from '../src/services/staticService.js';

let server;
let base;
let distDir;

test.before(async () => {
  distDir = await mkdtemp(join(tmpdir(), 'spec-platform-dist-'));
  await mkdir(join(distDir, 'assets'));
  await writeFile(join(distDir, 'index.html'), '<html><body>SPA</body></html>');
  await writeFile(join(distDir, 'assets', 'app.js'), 'console.log("hi")');
  process.env.SPEC_PLATFORM_WEB_DIR = distDir;
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await rm(distDir, { recursive: true, force: true });
});

test('GET / 返回 index.html', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /SPA/);
});

test('GET /assets/app.js 返回静态文件与正确 content-type', async () => {
  const res = await fetch(`${base}/assets/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
  assert.match(await res.text(), /console\.log/);
});

test('GET /projects（SPA 前端路由）回退到 index.html', async () => {
  const res = await fetch(`${base}/projects`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /SPA/);
});

test('非法编码路径返回 400 JSON', async () => {
  // 注：%2e%2e%2f 会被 fetch 的 URL 解析规范化，到不了服务端；
  // 编码穿越由下方 resolveStaticPath 单测覆盖，这里测非法编码分支
  const res = await fetch(`${base}/%zz`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('GET /api/health 仍走 API（前缀分流不破坏既有路由）', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.ok, true);
});

test('resolveStaticPath：穿越返回 null，正常路径返回拼接结果', () => {
  assert.equal(resolveStaticPath('/srv/dist', '/../etc/passwd'), null);
  assert.equal(resolveStaticPath('/srv/dist', '/assets/app.js'), join('/srv/dist', 'assets/app.js'));
  assert.equal(resolveStaticPath('/srv/dist', '/%zz'), null); // 非法编码
});

test('resolveStaticPath：NUL 字节与尾斜杠 distDir', () => {
  assert.equal(resolveStaticPath('/srv/dist', '/a%00b.png'), null); // NUL → 拒绝
  // distDir 带尾斜杠时前缀判断仍正确（M4 回归）
  assert.equal(resolveStaticPath('/srv/dist/', '/assets/app.js'), join('/srv/dist', 'assets/app.js'));
});

test('HEAD / 返回 200 头信息且无 body', async () => {
  const res = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(await res.text(), '');
});

test('带扩展名的缺失资源返回 404，不回退 index.html（M1 回归）', async () => {
  const res = await fetch(`${base}/assets/missing.js`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('contentTypeFor：常见扩展名映射，未知回退 octet-stream', () => {
  assert.match(contentTypeFor('a/index.html'), /text\/html/);
  assert.match(contentTypeFor('a/b.css'), /text\/css/);
  assert.match(contentTypeFor('a/b.json'), /application\/json/);
  assert.match(contentTypeFor('a/b.unknown'), /application\/octet-stream/);
});
