import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AiPanel, { OPSX_OPTIONS } from './AiPanel.jsx';
import { startAiRun, getAiRun, listAiRuns } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  startAiRun: vi.fn(),
  getAiRun: vi.fn(),
  listAiRuns: vi.fn(),
}));

const RUNNING_JOB = {
  id: 'job-1',
  projectPath: '/tmp/demo',
  command: 'propose',
  input: '加登录',
  status: 'running',
  exitCode: null,
  startedAt: '2026-09-24T10:00:00.000Z',
  finishedAt: null,
  error: null,
};

function renderPanel(pollIntervalMs = 10) {
  return render(<AiPanel projectPath="/tmp/demo" pollIntervalMs={pollIntervalMs} />);
}

describe('AiPanel AI 工作流面板', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAiRuns.mockResolvedValue([]);
  });

  it('渲染 11 个 opsx 命令选项，默认 propose', () => {
    renderPanel(99999);
    const select = screen.getByLabelText('AI 工作流（/opsx:*）');
    expect(select.value).toBe('propose');
    expect(OPSX_OPTIONS).toHaveLength(11);
    expect(select.querySelectorAll('option')).toHaveLength(11);
  });

  it('点击 AI 运行：调 startAiRun 并进入运行中状态（按钮禁用）', async () => {
    startAiRun.mockResolvedValue(RUNNING_JOB);
    getAiRun.mockResolvedValue({ ...RUNNING_JOB, output: '', nextOffset: 0 });
    const user = userEvent.setup();
    renderPanel(99999);
    await user.selectOptions(screen.getByLabelText('AI 工作流（/opsx:*）'), 'apply');
    await user.type(screen.getByLabelText('需求描述'), '加登录');
    await user.click(screen.getByRole('button', { name: 'AI 运行' }));
    expect(startAiRun).toHaveBeenCalledWith('/tmp/demo', 'apply', '加登录');
    expect(await screen.findByText('运行中')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI 运行中…' }).disabled).toBe(true);
  });

  it('轮询按 offset 增量拼接输出，任务完成后显示已完成', async () => {
    startAiRun.mockResolvedValue(RUNNING_JOB);
    getAiRun
      .mockResolvedValueOnce({ ...RUNNING_JOB, output: '第一段', nextOffset: 3 })
      .mockResolvedValue({ ...RUNNING_JOB, status: 'done', exitCode: 0, output: '第二段', nextOffset: 6 });
    const user = userEvent.setup();
    renderPanel(10);
    await user.click(screen.getByRole('button', { name: 'AI 运行' }));
    expect(await screen.findByText(/第一段第二段/)).toBeTruthy();
    expect(await screen.findByText('已完成')).toBeTruthy();
    expect(getAiRun).toHaveBeenCalledWith('job-1', 0);
    expect(getAiRun).toHaveBeenCalledWith('job-1', 3);
  });

  it('任务失败：显示失败徽标与退出码', async () => {
    startAiRun.mockResolvedValue(RUNNING_JOB);
    getAiRun.mockResolvedValue({
      ...RUNNING_JOB,
      status: 'failed',
      exitCode: 1,
      output: '出错了',
      nextOffset: 3,
    });
    const user = userEvent.setup();
    renderPanel(10);
    await user.click(screen.getByRole('button', { name: 'AI 运行' }));
    expect(await screen.findByText('失败')).toBeTruthy();
    expect(screen.getByText(/退出码 1/)).toBeTruthy();
  });

  it('startAiRun 被拒（409 冲突）显示错误横幅', async () => {
    startAiRun.mockRejectedValue(
      Object.assign(new Error('发生冲突：该项目已有 AI 任务运行中'), { status: 409 }),
    );
    const user = userEvent.setup();
    renderPanel(99999);
    await user.click(screen.getByRole('button', { name: 'AI 运行' }));
    expect(await screen.findByText(/已有 AI 任务运行中/)).toBeTruthy();
  });

  it('挂载时恢复运行中任务（刷新页面场景）', async () => {
    listAiRuns.mockResolvedValue([
      { ...RUNNING_JOB, status: 'done' },
      RUNNING_JOB,
    ]);
    getAiRun.mockResolvedValue({ ...RUNNING_JOB, status: 'done', exitCode: 0, output: '恢复的输出', nextOffset: 5 });
    renderPanel(10);
    expect(await screen.findByText(/恢复的输出/)).toBeTruthy();
    expect(listAiRuns).toHaveBeenCalledWith('/tmp/demo');
  });

  it('轮询响应慢于间隔时不会并发在飞（链式 setTimeout）', async () => {
    startAiRun.mockResolvedValue(RUNNING_JOB);
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    getAiRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          calls += 1;
          setTimeout(() => {
            inFlight -= 1;
            resolve(
              calls >= 3
                ? { ...RUNNING_JOB, status: 'done', exitCode: 0, output: 'c', nextOffset: 3 }
                : { ...RUNNING_JOB, output: 'x', nextOffset: calls },
            );
          }, 40); // 响应 40ms > 轮询间隔 5ms
        }),
    );
    const user = userEvent.setup();
    renderPanel(5);
    await user.click(screen.getByRole('button', { name: 'AI 运行' }));
    expect(await screen.findByText('已完成')).toBeTruthy();
    expect(maxInFlight).toBe(1);
  });

  it('startAiRun 落定前按钮禁用（防双击重复提交）', async () => {
    let release;
    startAiRun.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderPanel(99999);
    await user.click(screen.getByRole('button', { name: 'AI 运行' }));
    expect(screen.getByRole('button', { name: 'AI 运行' }).disabled).toBe(true);
    release(RUNNING_JOB);
    expect(await screen.findByText('运行中')).toBeTruthy();
  });

  it('服务端截断产生 gapChars 时插入截断标记', async () => {
    startAiRun.mockResolvedValue(RUNNING_JOB);
    getAiRun
      .mockResolvedValueOnce({ ...RUNNING_JOB, output: '头部', nextOffset: 2, gapChars: 0 })
      .mockResolvedValue({
        ...RUNNING_JOB, status: 'done', exitCode: 0,
        output: '尾部', nextOffset: 10, gapChars: 8,
      });
    const user = userEvent.setup();
    renderPanel(10);
    await user.click(screen.getByRole('button', { name: 'AI 运行' }));
    expect(await screen.findByText(/服务端已截断 8 字符/)).toBeTruthy();
  });
});
