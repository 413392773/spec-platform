import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProjectsPage from './ProjectsPage.jsx';
import { listProjects, runCommand, previewUpgrade } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  listProjects: vi.fn(),
  runCommand: vi.fn(),
  // AiPanel 挂载即调用（恢复运行中任务），默认无任务
  listAiRuns: vi.fn().mockResolvedValue([]),
  startAiRun: vi.fn(),
  getAiRun: vi.fn(),
  // UpgradePanel 仅在点击检查时调用
  previewUpgrade: vi.fn(),
  applyUpgrade: vi.fn(),
}));

const PROJECTS = [
  {
    name: 'demo-app',
    path: '/tmp/demo-app',
    mode: 'spec-large-self',
    schemaVersion: 2,
    createdAt: '2026-09-24T03:00:00.000Z',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );
}

describe('ProjectsPage 项目列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染项目卡片：名称、模式、schema 版本', async () => {
    listProjects.mockResolvedValue(PROJECTS);
    renderPage();
    expect(await screen.findByText('demo-app')).toBeTruthy();
    expect(screen.getByText(/spec-large-self/)).toBeTruthy();
    expect(screen.getByText(/schema v2/)).toBeTruthy();
  });

  it('空列表显示引导链接', async () => {
    listProjects.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/还没有项目/)).toBeTruthy();
  });

  it('加载失败显示错误横幅', async () => {
    listProjects.mockRejectedValue(new Error('无法连接平台服务'));
    renderPage();
    expect(await screen.findByText(/无法连接平台服务/)).toBeTruthy();
  });

  it('点击"体检"跑 cliRun 并展示输出', async () => {
    listProjects.mockResolvedValue(PROJECTS);
    runCommand.mockResolvedValue({ exitCode: 0, stdout: 'All good', stderr: '' });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '体检' }));
    expect(await screen.findByText(/All good/)).toBeTruthy();
    await waitFor(() =>
      expect(runCommand).toHaveBeenCalledWith('/tmp/demo-app', ['doctor']),
    );
  });

  it('命令非零退出码显示红色提示', async () => {
    listProjects.mockResolvedValue(PROJECTS);
    runCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '查看变更列表' }));
    expect(await screen.findByText(/退出码 1/)).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it('runCommand 请求失败显示错误横幅', async () => {
    listProjects.mockResolvedValue(PROJECTS);
    runCommand.mockRejectedValue(new Error('发生冲突：不是有效的 openspec 项目'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Schema 来源' }));
    expect(await screen.findByText(/不是有效的 openspec 项目/)).toBeTruthy();
  });

  it('卡片带 schema 升级面板：检查后显示版本状态', async () => {
    listProjects.mockResolvedValue(PROJECTS);
    previewUpgrade.mockResolvedValue({
      upgradable: false,
      mode: 'spec-large-self',
      currentVersion: 2,
      latestVersion: 2,
      files: [],
      summary: {},
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '检查 schema 升级' }));
    expect(await screen.findByText(/已是最新/)).toBeTruthy();
    expect(previewUpgrade).toHaveBeenCalledWith('/tmp/demo-app');
  });
});
