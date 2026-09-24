import { extname, join, normalize, resolve, sep } from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** 按扩展名查 Content-Type，未知扩展名回退二进制流 */
export function contentTypeFor(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 把 URL pathname 安全映射为 distDir 内的文件路径。
 * 非法（编码错误 / 含 NUL / 路径穿越 / 越出 distDir）→ 返回 null，由调用方回 400。
 */
export function resolveStaticPath(distDir, pathname) {
  // resolve 消掉尾斜杠等差异，避免 startsWith 前缀判断被 "/dist/" 形态破坏
  const root = resolve(distDir);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // %zz 之类非法编码
  }
  if (decoded.includes('\0')) return null; // NUL 会让 readFile 抛 500 并泄漏路径
  if (decoded.split(/[\\/]/).includes('..')) return null;
  const target = join(root, normalize(decoded));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}
