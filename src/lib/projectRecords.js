import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDataDir } from './paths.js';

const RECORDS_FILE = 'projects.json';

const recordsPath = () => join(getDataDir(), RECORDS_FILE);

/** 读取项目创建记录；文件不存在返回空数组，损坏则显式报错 */
export async function readRecords() {
  let raw;
  try {
    raw = await readFile(recordsPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${RECORDS_FILE} 损坏：顶层应为数组`);
  }
  return parsed;
}

/** 不可变追加：读旧数组 → 新数组 → 整体写入（不原地修改） */
export async function appendRecord(record) {
  const next = [...(await readRecords()), record];
  await mkdir(getDataDir(), { recursive: true });
  await writeFile(recordsPath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
