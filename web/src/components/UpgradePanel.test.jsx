import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import UpgradePanel from './UpgradePanel.jsx';
import { previewUpgrade, applyUpgrade } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  previewUpgrade: vi.fn(),
  applyUpgrade: vi.fn(),
}));

const PREVIEW = {
  upgradable: true,
  mode: 'demo-mode',
  currentVersion: 2,
  latestVersion: 3,
  files: [
    { path: 'schema.yaml', action: 'platform-update' },
    { path: 'templates/proposal.md', action: 'conflict', ours: '我的版本', theirs: '母本新版本' },
    { path: 'templates/tasks.md', action: 'auto-merge' },
    { path: 'templates/added.md', action: 'add' },
    { path: 'templates/removed.md', action: 'delete' },
    { path: 'templates/design.md', action: 'user-keep' },
  ],
  summary: { 'platform-update': 1, conflict: 1, 'auto-merge': 1, add: 1, delete: 1, 'user-keep': 1 },
};

const APPLY_RESULT = {
  fromVersion: 2,
  toVersion: 3,
  mode: 'demo-mode',
  written: ['schema.yaml', 'templates/tasks.md'],
  deleted: ['templates/removed.md'],
  kept: ['templates/proposal.md', 'templates/design.md'],
  backupDir: 'data/backups/demo-2026-09-24T10-00-00-000Z',
};

function renderPanel() {
  return render(<UpgradePanel projectPath="/tmp/demo" />);
}

async function clickCheck(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: '检查 schema 升级' }));
}

describe('UpgradePanel schema 升级面板', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('点击检查按钮：显示版本跨度与逐文件分类中文标签', async () => {
    previewUpgrade.mockResolvedValue(PREVIEW);
    renderPanel();
    await clickCheck();
    expect(previewUpgrade).toHaveBeenCalledWith('/tmp/demo');
    expect(await screen.findByText(/v2 → v3/)).toBeTruthy();
    // 摘要行（summary 渲染，非死载荷）
    expect(screen.getByText(/平台更新 1 · 冲突（需裁决） 1 · 自动合并 1/)).toBeTruthy();
    expect(screen.getByText('schema.yaml')).toBeTruthy();
    // 逐文件标签（li 内 " — 标签"，与摘要行区分）
    expect(screen.getByText(/— 平台更新/)).toBeTruthy();
    expect(screen.getByText(/— 自动合并/)).toBeTruthy();
    expect(screen.getByText(/— 平台新增/)).toBeTruthy();
    expect(screen.getByText(/— 平台删除/)).toBeTruthy();
    expect(screen.getByText(/— 保留我的修改/)).toBeTruthy();
    expect(screen.getByText(/— 冲突（需裁决）/)).toBeTruthy();
  });

  it('已是最新版本：显示提示，不出现执行按钮', async () => {
    previewUpgrade.mockResolvedValue({ ...PREVIEW, upgradable: false, currentVersion: 3, files: [], summary: {} });
    renderPanel();
    await clickCheck();
    expect(await screen.findByText(/已是最新/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '执行升级' })).toBeNull();
  });

  it('冲突文件：未裁决时执行按钮禁用，预览全文可见两边内容', async () => {
    previewUpgrade.mockResolvedValue(PREVIEW);
    const user = userEvent.setup();
    renderPanel();
    await clickCheck(user);
    expect(await screen.findByRole('button', { name: '执行升级' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '执行升级' }).disabled).toBe(true);
    // details 预览全文：我的版本 / 母本新版
    expect(screen.getByText('我的版本')).toBeTruthy();
    expect(screen.getByText('母本新版本')).toBeTruthy();
  });

  it('裁决"保留我的"后执行按钮启用；执行传裁决并回调 onUpgraded', async () => {
    previewUpgrade.mockResolvedValue(PREVIEW);
    applyUpgrade.mockResolvedValue(APPLY_RESULT);
    const onUpgraded = vi.fn();
    const user = userEvent.setup();
    render(<UpgradePanel projectPath="/tmp/demo" onUpgraded={onUpgraded} />);
    await clickCheck(user);
    await user.click(await screen.findByRole('radio', { name: '保留我的' }));
    const apply = screen.getByRole('button', { name: '执行升级' });
    expect(apply.disabled).toBe(false);
    await user.click(apply);
    expect(applyUpgrade).toHaveBeenCalledWith('/tmp/demo', { 'templates/proposal.md': 'ours' });
    expect(await screen.findByText(/升级完成：v2 → v3/)).toBeTruthy();
    expect(screen.getByText(/demo-2026-09-24T10-00-00-000Z/)).toBeTruthy();
    expect(onUpgraded).toHaveBeenCalledTimes(1);
  });

  it('多个冲突：每个文件独立裁决（用母本新版 → theirs）', async () => {
    previewUpgrade.mockResolvedValue({
      ...PREVIEW,
      files: [
        { path: 'templates/a.md', action: 'conflict', ours: 'A 我的', theirs: 'B 母本' },
        { path: 'templates/b.md', action: 'conflict', ours: 'B 我的', theirs: 'B 母本' },
      ],
    });
    applyUpgrade.mockResolvedValue(APPLY_RESULT);
    const user = userEvent.setup();
    render(<UpgradePanel projectPath="/tmp/demo" />);
    await clickCheck(user);
    const groupA = (await screen.findByText('templates/a.md')).closest('li');
    const groupB = screen.getByText('templates/b.md').closest('li');
    await user.click(within(groupA).getByRole('radio', { name: '保留我的' }));
    await user.click(within(groupB).getByRole('radio', { name: '用母本新版' }));
    await user.click(screen.getByRole('button', { name: '执行升级' }));
    expect(applyUpgrade).toHaveBeenCalledWith('/tmp/demo', {
      'templates/a.md': 'ours',
      'templates/b.md': 'theirs',
    });
  });

  it('检查失败（未登记项目）显示错误横幅', async () => {
    previewUpgrade.mockRejectedValue(
      Object.assign(new Error('项目未在平台登记：只有通过平台创建的项目才能使用该功能'), { status: 400 }),
    );
    renderPanel();
    await clickCheck();
    expect(await screen.findByText(/未在平台登记/)).toBeTruthy();
  });

  it('执行失败（409 未裁决）显示错误横幅', async () => {
    previewUpgrade.mockResolvedValue({ ...PREVIEW, files: PREVIEW.files.filter((f) => f.action !== 'conflict'), summary: {} });
    applyUpgrade.mockRejectedValue(Object.assign(new Error('存在未裁决冲突：templates/x.md'), { status: 409 }));
    const user = userEvent.setup();
    renderPanel();
    await clickCheck(user);
    await user.click(await screen.findByRole('button', { name: '执行升级' }));
    expect(await screen.findByText(/存在未裁决冲突/)).toBeTruthy();
  });

  it('检查请求在飞时按钮禁用（防双击）', async () => {
    let release;
    previewUpgrade.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<UpgradePanel projectPath="/tmp/demo" />);
    await user.click(screen.getByRole('button', { name: '检查 schema 升级' }));
    expect(screen.getByRole('button', { name: '检查 schema 升级' }).disabled).toBe(true);
    release({ ...PREVIEW, upgradable: false, currentVersion: 3, files: [], summary: {} });
    expect(await screen.findByText(/已是最新/)).toBeTruthy();
  });
});
