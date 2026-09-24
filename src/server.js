import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleRequest, sendJson } from './routes/router.js';

const DEFAULT_PORT = 3000;

export function createServer() {
  return createHttpServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      // 兜底：handleRequest 自身已捕获业务错误，这里防路由层意外崩溃
      sendJson(res, 500, { success: false, error: `内部错误: ${err.message}` });
    });
  });
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  createServer().listen(port, () => {
    console.log(`spec-platform 监听 http://localhost:${port}`);
  });
}
