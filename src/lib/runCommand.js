import { execFile } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * 无 shell 执行命令（execFile 不经 shell，天然免疫命令注入）。
 * resolve {exitCode, stdout, stderr}；非零退出码不抛错，由调用方决定处理。
 * 命令不存在（ENOENT）或超时 → reject（调用方包装为 EnvError）。
 */
export function runCommand(command, args, options = {}) {
  const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error?.code === 'ENOENT') {
          reject(new Error(`命令不存在: ${command}（请先安装并确保在 PATH 中）`));
          return;
        }
        if (error?.killed) {
          reject(new Error(`命令超时(>${timeoutMs}ms): ${command} ${args.join(' ')}`));
          return;
        }
        const exitCode = error
          ? typeof error.code === 'number'
            ? error.code
            : 1
          : 0;
        resolve({ exitCode, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}
