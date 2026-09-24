import { runCommand } from '../lib/runCommand.js';
import { ValidationError, ConflictError, EnvError } from '../lib/errors.js';
import { listModes } from '../services/registryService.js';
import { create, listProjects } from '../services/projectService.js';
import { run } from '../services/openspecService.js';

const MAX_BODY_BYTES = 1024 * 1024;

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** 读取并解析 JSON 请求体；超限/非法 JSON → ValidationError */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError('请求体过大（>1MB）'));
        req.destroy();
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

/** 统一 API 信封：{success, data} / {success:false, error} */
export async function handleRequest(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const route = `${req.method} ${pathname}`;
  try {
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
    sendJson(res, 500, { success: false, error: err.message });
  }
}
