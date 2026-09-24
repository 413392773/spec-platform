import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // src/lib

/** 平台仓库根目录 */
export const PLATFORM_ROOT = resolve(HERE, '..', '..');

/** schema 母本目录（核心资产） */
export const getTemplatesDir = () => join(PLATFORM_ROOT, 'templates', 'schemas');

/** 运行时数据目录；测试通过 SPEC_PLATFORM_DATA_DIR 隔离 */
export const getDataDir = () =>
  process.env.SPEC_PLATFORM_DATA_DIR || join(PLATFORM_ROOT, 'data');

/** 前端构建产物目录；测试通过 SPEC_PLATFORM_WEB_DIR 隔离 */
export const getWebDistDir = () =>
  process.env.SPEC_PLATFORM_WEB_DIR || join(PLATFORM_ROOT, 'web', 'dist');
