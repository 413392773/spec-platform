import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { ValidationError } from './errors.js';
import { readRecords } from './projectRecords.js';

/**
 * 项目准入公共校验（aiRun / schema 升级共用）：
 * 绝对路径 → realpath 归一 → 必须在平台登记表内。
 * 返回 { realPath, record }；不满足抛 ValidationError。
 */
export async function findRegisteredProject(projectPath) {
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) {
    throw new ValidationError('projectPath 必须是绝对路径');
  }
  let realPath;
  try {
    realPath = realpathSync(projectPath);
  } catch {
    throw new ValidationError(`项目路径不存在: ${projectPath}`);
  }
  const records = await readRecords();
  const record = records.find((entry) => {
    try {
      return realpathSync(entry.path) === realPath;
    } catch {
      return false;
    }
  });
  if (!record) {
    throw new ValidationError('项目未在平台登记：只有通过平台创建的项目才能使用该功能');
  }
  return { realPath, record };
}
