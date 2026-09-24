import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDataDir } from './paths.js';

const RECORDS_FILE = 'projects.json';

const recordsPath = () => join(getDataDir(), RECORDS_FILE);

/** 原子写：先写临时文件再 rename 替换，写一半失败不会损坏 projects.json */
async function writeRecordsAtomic(records) {
  const target = recordsPath();
  const tmpPath = `${target}.tmp`;
  await mkdir(getDataDir(), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`);
  await rename(tmpPath, target);
}

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

/** 不可变追加：读旧数组 → 新数组 → 原子写入（不原地修改） */
export async function appendRecord(record) {
  const next = [...(await readRecords()), record];
  await writeRecordsAtomic(next);
  return next;
}

/** 不可变更新：按 path 定位记录并浅合并 patch；未找到返回 null（不落盘） */
export async function updateRecord(path, patch) {
  const records = await readRecords();
  const index = records.findIndex((record) => record.path === path);
  if (index === -1) return null;
  const next = records.map((record, i) =>
    i === index ? { ...record, ...patch } : record,
  );
  await writeRecordsAtomic(next);
  return next[index];
}
