/**
 * 平台 API 客户端：统一信封解包 + 小白话术错误翻译。
 * 后端约定：成功 {success:true,data} / 失败 {success:false,error}（见 src/routes/router.js）。
 */

export class ApiError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? null;
    if (cause !== undefined) this.cause = cause;
  }
}

const STATUS_HINTS = {
  400: '请检查填写内容',
  409: '发生冲突',
  500: '平台内部错误',
};

function translate(status, rawMessage) {
  const detail = rawMessage || `HTTP ${status}`;
  const hint = STATUS_HINTS[status];
  return hint ? `${hint}：${detail}` : detail;
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    throw new ApiError('无法连接平台服务，请确认后端已启动（npm start）', { cause: err });
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new ApiError(`平台服务返回格式异常（HTTP ${res.status}）`, {
      status: res.status,
      cause: err,
    });
  }
  if (!res.ok || body?.success !== true) {
    throw new ApiError(translate(res.status, body?.error), { status: res.status });
  }
  return body.data;
}

function postJson(path, payload) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getHealth() {
  return request('/api/health');
}

export async function getSchemas() {
  const data = await request('/api/schemas');
  return data.schemas;
}

export function createProject(form) {
  return postJson('/api/projects', form);
}

export async function listProjects() {
  const data = await request('/api/projects');
  return data.projects;
}

export function runCommand(path, args) {
  return postJson('/api/projects/run', { path, args });
}

export function startAiRun(path, command, input) {
  return postJson('/api/projects/airun', { path, command, input });
}

export function getAiRun(id, offset = 0) {
  const safeOffset = Number(offset) || 0; // 调用方传脏值也不拼进 URL
  return request(`/api/airun/${encodeURIComponent(id)}?offset=${safeOffset}`);
}

export async function listAiRuns(path) {
  const data = await request(`/api/projects/airun?path=${encodeURIComponent(path)}`);
  return data.jobs;
}
