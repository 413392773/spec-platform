import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError,
  getHealth,
  getSchemas,
  createProject,
  listProjects,
  runCommand,
} from './client.js';

function mockResponse(status, body) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('API 客户端', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockResponse(200, { success: true, data: {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getHealth 返回 openspec 版本信息', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { ok: true, openspecVersion: '1.5.0' } }),
    });
    const data = await getHealth();
    expect(data.openspecVersion).toBe('1.5.0');
    expect(fetch).toHaveBeenCalledWith('/api/health', undefined);
  });

  it('getSchemas 返回模式数组', async () => {
    const schemas = [{ name: 'spec-large-self', label: '大项目模式', version: 2, default: true }];
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { schemas } }),
    });
    await expect(getSchemas()).resolves.toEqual(schemas);
  });

  it('createProject 以 JSON POST 表单并返回记录', async () => {
    const form = { name: 'demo', path: '/tmp/demo', mode: 'spec-large-self', context: {} };
    const record = { name: 'demo', path: '/tmp/demo', mode: 'spec-large-self', schemaVersion: 2 };
    fetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ success: true, data: record }),
    });
    await expect(createProject(form)).resolves.toEqual(record);
    expect(fetch).toHaveBeenCalledWith('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
  });

  it('listProjects 返回项目数组（空列表也正常）', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { projects: [] } }),
    });
    await expect(listProjects()).resolves.toEqual([]);
  });

  it('runCommand 传路径与参数，返回 exitCode/stdout/stderr', async () => {
    const result = { exitCode: 0, stdout: 'Source: project', stderr: '' };
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: result }),
    });
    await expect(runCommand('/tmp/demo', ['schema', 'which'])).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith('/api/projects/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/demo', args: ['schema', 'which'] }),
    });
  });

  it('400 → ApiError，消息带填写检查提示', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ success: false, error: 'name 必填且须为 kebab-case' }),
    });
    const err = await getSchemas().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toContain('name 必填且须为 kebab-case');
  });

  it('409 → ApiError，消息带冲突提示', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ success: false, error: '目标路径已包含 openspec 项目' }),
    });
    const err = await listProjects().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toContain('目标路径已包含 openspec 项目');
  });

  it('网络不通 → ApiError，提示检查后端', async () => {
    fetch.mockRejectedValue(new TypeError('fetch failed'));
    const err = await getHealth().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain('无法连接平台服务');
  });

  it('响应不是合法 JSON → ApiError', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('bad json')),
    });
    const err = await getHealth().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain('返回格式异常');
  });
});
