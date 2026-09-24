import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { runCommand } from '../lib/runCommand.js';
import { ValidationError } from '../lib/errors.js';

/**
 * cliRun 白名单：只代理只读/管理类命令。
 * init/store/config/update 等改变平台或全局状态的命令一律禁止。
 */
export const ALLOWED_COMMANDS = new Set([
  'list',
  'view',
  'doctor',
  'context',
  'archive',
  'change',
  'spec',
  'schema',
]);

export const ALLOWED_FLAGS = new Set(['--version', '--help', '--no-color', '--json']);

/**
 * 以目标项目为 cwd 执行 openspec 命令（cliRun 通道）。
 * 校验：绝对路径 + 存在 openspec/ 目录 + args 非空字符串数组 + 白名单。
 * 返回 {exitCode, stdout, stderr}，非零退出码不抛错由调用方处理。
 */
export async function run(projectPath, args, options = {}) {
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) {
    throw new ValidationError('projectPath 必须是绝对路径');
  }
  if (!existsSync(projectPath) || !existsSync(join(projectPath, 'openspec'))) {
    throw new ValidationError(`不是有效的 openspec 项目（缺少 openspec/ 目录）: ${projectPath}`);
  }
  if (!Array.isArray(args) || args.length === 0 || args.some((a) => typeof a !== 'string')) {
    throw new ValidationError('args 必须是非空字符串数组');
  }
  if (!ALLOWED_COMMANDS.has(args[0]) && !ALLOWED_FLAGS.has(args[0])) {
    throw new ValidationError(
      `命令不在白名单: ${args[0]}（允许: ${[...ALLOWED_COMMANDS].join(', ')}）`,
    );
  }
  return runCommand('openspec', args, { cwd: projectPath, ...options });
}
