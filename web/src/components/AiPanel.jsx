import { useCallback, useEffect, useRef, useState } from 'react';
import { startAiRun, getAiRun, listAiRuns } from '../api/client.js';

/** 11 个 /opsx:* 工作流（与后端 aiRunService.OPSX_COMMANDS 一致），带小白话术说明 */
export const OPSX_OPTIONS = [
  { name: 'propose', label: '提出变更（生成 proposal/design/tasks）' },
  { name: 'apply', label: '实施变更（按 tasks 写代码）' },
  { name: 'continue', label: '继续未完成的变更' },
  { name: 'ff', label: '快进（补齐缺失的工件）' },
  { name: 'new', label: '新建变更（只搭脚手架）' },
  { name: 'explore', label: '探索项目现状' },
  { name: 'verify', label: '验证变更是否符合规格' },
  { name: 'sync', label: '同步规格' },
  { name: 'archive', label: '归档已完成的变更' },
  { name: 'bulk-archive', label: '批量归档' },
  { name: 'onboard', label: '项目上手引导' },
];

const DEFAULT_POLL_MS = 1500;
const STATUS_LABELS = { running: '运行中', done: '已完成', failed: '失败' };

/**
 * 项目卡片内的 AI 工作流面板：选命令 + 填需求 → 后端 spawn claude -p，
 * 前端按 offset 增量轮询输出（链式 setTimeout，慢响应不会并发在飞）。
 * 刷新页面后自动重挂运行中任务。
 */
export default function AiPanel({ projectPath, pollIntervalMs = DEFAULT_POLL_MS }) {
  const [command, setCommand] = useState('propose');
  const [input, setInput] = useState('');
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const offsetRef = useRef(0);
  const outputRef = useRef('');

  const fetchRunningJob = useCallback(
    () =>
      listAiRuns(projectPath)
        .then((jobs) => jobs.find((j) => j.status === 'running') ?? null)
        .catch(() => null), // 恢复失败不影响手动使用
    [projectPath],
  );

  useEffect(() => {
    let ignore = false;
    fetchRunningJob().then((running) => {
      if (ignore || !running) return;
      offsetRef.current = 0;
      outputRef.current = '';
      setJob({ ...running, output: '' });
    });
    return () => {
      ignore = true;
    };
  }, [fetchRunningJob]);

  useEffect(() => {
    if (!job || job.status !== 'running') return undefined;
    let timer;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getAiRun(job.id, offsetRef.current);
        if (cancelled) return;
        if (next.gapChars > 0) {
          outputRef.current += `\n[…服务端已截断 ${next.gapChars} 字符…]\n`;
        }
        outputRef.current += next.output;
        offsetRef.current = next.nextOffset;
        setError(null); // 轮询恢复即清除临时错误（如一次网络抖动）
        setJob({ ...next, output: outputRef.current });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
      if (!cancelled) timer = setTimeout(poll, pollIntervalMs); // 链式：上一次落定才排下一次
    };
    timer = setTimeout(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在任务身份/状态变化时重建轮询
  }, [job?.id, job?.status, pollIntervalMs]);

  const start = async () => {
    setError(null);
    setIsStarting(true);
    try {
      const created = await startAiRun(projectPath, command, input.trim());
      offsetRef.current = 0;
      outputRef.current = '';
      setJob({ ...created, output: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsStarting(false);
    }
  };

  const isRunning = job?.status === 'running';
  const isBusy = isRunning || isStarting;
  const showOutput = job && (isRunning || job.output);

  return (
    <div className="field">
      <label htmlFor={`ai-cmd-${projectPath}`}>AI 工作流（/opsx:*）</label>
      <div className="row">
        <select
          id={`ai-cmd-${projectPath}`}
          value={command}
          disabled={isBusy}
          onChange={(e) => setCommand(e.target.value)}
        >
          {OPSX_OPTIONS.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name} — {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <input
          aria-label="需求描述"
          value={input}
          placeholder="例：加用户登录，支持手机验证码"
          disabled={isBusy}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn" onClick={start} disabled={isBusy}>
          {isRunning ? 'AI 运行中…' : 'AI 运行'}
        </button>
      </div>
      <p className="hint">
        AI 会读写本项目文件并执行 openspec/git 命令（无头运行，git push/commit/config 已禁用）；
        请勿对包含不可信第三方内容的项目使用。
      </p>
      {error ? <div className="banner error">{error}</div> : null}
      {job ? (
        <div>
          <p className="hint">
            /opsx:{job.command} ·{' '}
            <span className={job.status === 'failed' ? 'badge danger' : 'badge'}>
              {STATUS_LABELS[job.status] ?? job.status}
            </span>
            {job.status === 'failed' && job.exitCode !== null && job.exitCode !== undefined
              ? `（退出码 ${job.exitCode}）`
              : ''}
            {job.error ? `：${job.error}` : ''}
          </p>
          {showOutput ? <pre className="output">{job.output || '（暂无输出）'}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
