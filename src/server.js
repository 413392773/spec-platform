import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleRequest, sendJson } from './routes/router.js';

const DEFAULT_PORT = 3000;

export function createServer() {
  return createHttpServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      // 兜底：handleRequest 自身已捕获业务错误，这里防路由层意外崩溃
      console.error('[500]', err);
      sendJson(res, 500, { success: false, error: '内部错误（详情见服务端日志）' });
    });
  });
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  // 默认只绑回环：无鉴权 API 不得暴露到局域网。
  // 确需局域网访问时显式设置 HOST=0.0.0.0（同时会放开 Host 头校验，见 router.js）
  const host = process.env.HOST ?? '127.0.0.1';
  createServer().listen(port, host, () => {
    console.log(`spec-platform 监听 http://${host}:${port}`);
  });
}
