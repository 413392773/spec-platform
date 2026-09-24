import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../lib/runCommand.js';
import { ValidationError, ConflictError, EnvError } from '../lib/errors.js';
import { getWebDistDir } from '../lib/paths.js';
import { listModes } from '../services/registryService.js';
import { create, listProjects } from '../services/projectService.js';
import { run } from '../services/openspecService.js';
import { launch, getJob, listJobsFor } from '../services/aiRunService.js';
import { resolveStaticPath, contentTypeFor } from '../services/staticService.js';

const MAX_BODY_BYTES = 1024 * 1024;
const API_PREFIX = '/api';
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Host 白名单：默认只接受回环 Host，防 DNS rebinding。
 * 显式设置 HOST 绑定非回环地址时视为用户主动开放局域网，跳过校验（README 已标注风险）。
 */
function isHostAllowed(req) {
  const bindHost = process.env.HOST;
  if (bindHost && !LOOPBACK_HOSTNAMES.has(bindHost)) return true;
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '');
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/** POST 必须是 application/json：跨站简单请求（text/plain 等）直接被拒，堵住 CSRF */
function assertJsonContentType(req) {
  if (req.method !== 'POST') return;
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new ValidationError('Content-Type 必须是 application/json');
  }
}

/** 读取并解析 JSON 请求体；超限/非法 JSON → ValidationError */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // 先停止消费再拒绝，让 400 响应能完整送达（直接 destroy 会导致连接重置）
        req.pause();
        reject(new ValidationError('请求体过大（>1MB）'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ValidationError('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 非 /api 的 GET/HEAD → 前端静态资源；无扩展名路径回退 index.html（SPA 路由） */
async function serveWebAsset(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 404, { success: false, error: `路由不存在: ${req.method} ${pathname}` });
    return;
  }
  const distDir = getWebDistDir();
  const target = resolveStaticPath(distDir, pathname);
  if (target === null) {
    sendJson(res, 400, { success: false, error: '非法请求路径' });
    return;
  }
  const indexFile = join(distDir, 'index.html');
  // 带扩展名的资源未命中就是 404，不回退 HTML（避免掩盖真实缺文件 + MIME 错配）
  const hasFileExtension = /\.[a-z0-9]+$/i.test(pathname);
  const candidates =
    target === distDir || hasFileExtension ? [target] : [target, indexFile];
  for (const file of candidates) {
    let data;
    try {
      data = await readFile(file);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') continue;
      throw err;
    }
    res.writeHead(200, {
      'content-type': contentTypeFor(file),
      'content-length': data.length,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
    return;
  }
  // 目录请求落到这里说明连 index.html 都没有 → 未构建；其余是真 404
  const isDirRequest = target === distDir || candidates.includes(indexFile);
  sendJson(res, 404, {
    success: false,
    error:
      isDirRequest && !existsSync(indexFile)
        ? '前端未构建：请先在 web/ 目录执行 npm run build'
        : '资源不存在',
  });
}

/** 统一 API 信封：{success, data} / {success:false, error}；API 一律挂 /api 前缀 */
export async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (!isHostAllowed(req)) {
      sendJson(res, 421, { success: false, error: 'Host 不被允许' });
      return;
    }
    if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) {
      await serveWebAsset(req, res, pathname);
      return;
    }
    assertJsonContentType(req);
    const declaredLength = Number(req.headers['content-length'] ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      sendJson(res, 400, { success: false, error: '请求体过大（>1MB）' });
      return;
    }
    const route = `${req.method} ${pathname.slice(API_PREFIX.length)}`;
    if (route === 'GET /health') {
      const version = await runCommand('openspec', ['--version']);
      if (version.exitCode !== 0) {
        throw new EnvError('openspec CLI 不可用，请先安装（npm i -g openspec）');
      }
      sendJson(res, 200, {
        success: true,
        data: { ok: true, openspecVersion: version.stdout.trim() },
      });
      return;
    }
    if (route === 'GET /schemas') {
      sendJson(res, 200, { success: true, data: { schemas: listModes() } });
      return;
    }
    if (route === 'POST /projects') {
      const form = await readJsonBody(req);
      const record = await create(form);
      sendJson(res, 201, { success: true, data: record });
      return;
    }
    if (route === 'GET /projects') {
      sendJson(res, 200, { success: true, data: { projects: await listProjects() } });
      return;
    }
    if (route === 'POST /projects/run') {
      const body = await readJsonBody(req);
      const result = await run(body?.path, body?.args);
      sendJson(res, 200, { success: true, data: result });
      return;
    }
    if (route === 'POST /projects/airun') {
      const body = await readJsonBody(req);
      const job = await launch(body?.path, body?.command, body?.input ?? '');
      sendJson(res, 202, { success: true, data: job });
      return;
    }
    if (route === 'GET /projects/airun') {
      const projectPath = url.searchParams.get('path');
      if (!projectPath) {
        throw new ValidationError('path 查询参数必填');
      }
      sendJson(res, 200, { success: true, data: { jobs: listJobsFor(projectPath) } });
      return;
    }
    if (route.startsWith('GET /airun/')) {
      const id = pathname.slice(`${API_PREFIX}/airun/`.length);
      const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
      const job = getJob(id, offset);
      if (!job) {
        sendJson(res, 404, { success: false, error: `AI 任务不存在: ${id}` });
        return;
      }
      sendJson(res, 200, { success: true, data: job });
      return;
    }
    sendJson(res, 404, { success: false, error: `路由不存在: ${route}` });
  } catch (err) {
    if (err instanceof ValidationError) {
      sendJson(res, 400, { success: false, error: err.message });
      return;
    }
    if (err instanceof ConflictError) {
      sendJson(res, 409, { success: false, error: err.message });
      return;
    }
    if (err instanceof EnvError) {
      // 环境类错误话术本就是给用户看的，保留消息
      sendJson(res, 500, { success: false, error: err.message });
      return;
    }
    console.error('[500]', err);
    sendJson(res, 500, { success: false, error: '内部错误（详情见服务端日志）' });
  }
}
