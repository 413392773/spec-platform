import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WizardPage from './WizardPage.jsx';
import { getSchemas, createProject } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  getSchemas: vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
}));

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/wizard/spec-large-self']}>
      <Routes>
        <Route path="/wizard/:mode" element={<WizardPage />} />
        <Route path="/projects" element={<div>我的项目</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillBasics(user, name, dir = '/Users/huahua/IdeaProjects') {
  await user.type(screen.getByLabelText('项目名'), name);
  const dirInput = screen.getByLabelText(/放在哪里/);
  await user.clear(dirInput); // 清掉 localStorage/env 可能的预填
  await user.type(dirInput, dir);
  await user.click(screen.getByRole('button', { name: '下一步' }));
}

async function fillContext(user, positioning, techStack) {
  await user.type(screen.getByLabelText(/这个项目是做什么的/), positioning);
  await user.type(screen.getByLabelText('技术栈'), techStack);
  await user.click(screen.getByRole('button', { name: '下一步' }));
}

describe('建项目向导', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('项目名非法时禁用"下一步"并给出提示', async () => {
    const user = userEvent.setup();
    renderWizard();
    const next = screen.getByRole('button', { name: '下一步' });
    expect(next.disabled).toBe(true);
    await user.type(screen.getByLabelText('项目名'), 'My-App');
    expect(next.disabled).toBe(true);
    expect(screen.getByText(/格式不对/)).toBeTruthy();
  });

  it('完整四步流程：提交成功显示创建结果', async () => {
    createProject.mockResolvedValue({
      name: 'demo-app',
      path: '/Users/huahua/IdeaProjects/demo-app',
      mode: 'spec-large-self',
      schemaVersion: 2,
      createdAt: '2026-09-24T03:00:00.000Z',
    });
    const user = userEvent.setup();
    renderWizard();
    await fillBasics(user, 'demo-app');
    await fillContext(user, '个人记账工具', 'Java 17 + Spring Boot 3');
    await user.click(screen.getByRole('button', { name: '下一步' })); // 高级选项直接过
    await user.click(screen.getByRole('button', { name: '创建项目' }));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        name: 'demo-app',
        path: '/Users/huahua/IdeaProjects/demo-app',
        mode: 'spec-large-self',
        context: { positioning: '个人记账工具', techStack: 'Java 17 + Spring Boot 3' },
      }),
    );
    expect(await screen.findByText(/已创建成功/)).toBeTruthy();
  });

  it('约定与附加规则会合并进提交体', async () => {
    createProject.mockResolvedValue({
      name: 'demo-app',
      path: '/Users/huahua/IdeaProjects/demo-app',
      mode: 'spec-large-self',
      schemaVersion: 2,
    });
    const user = userEvent.setup();
    renderWizard();
    await fillBasics(user, 'demo-app');
    await user.type(screen.getByLabelText(/这个项目是做什么的/), '记账工具');
    await user.type(screen.getByLabelText('技术栈'), 'Node.js');
    await user.type(screen.getByLabelText(/项目约定/), '接口统一 Result 包装');
    await user.click(screen.getByRole('button', { name: '添加约定' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '添加一条规则' }));
    await user.type(screen.getByLabelText('文档名 1'), 'prd');
    await user.type(screen.getByLabelText('规则内容 1'), '必须包含验收标准');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '创建项目' }));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        name: 'demo-app',
        path: '/Users/huahua/IdeaProjects/demo-app',
        mode: 'spec-large-self',
        context: {
          positioning: '记账工具',
          techStack: 'Node.js',
          conventions: ['接口统一 Result 包装'],
        },
        extraRules: { prd: ['必须包含验收标准'] },
      }),
    );
  });

  it('重复约定不会添加两次（H2 回归：key 冲突源头去重）', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillBasics(user, 'demo-app');
    const conventionInput = screen.getByLabelText(/项目约定/);
    await user.type(conventionInput, '接口统一 Result 包装');
    await user.click(screen.getByRole('button', { name: '添加约定' }));
    await user.type(conventionInput, '接口统一 Result 包装');
    await user.click(screen.getByRole('button', { name: '添加约定' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('提交失败（409）显示错误横幅', async () => {
    createProject.mockRejectedValue(
      Object.assign(new Error('发生冲突：目标路径已包含 openspec 项目'), { status: 409 }),
    );
    const user = userEvent.setup();
    renderWizard();
    await fillBasics(user, 'demo-app');
    await fillContext(user, '记账工具', 'Node.js');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '创建项目' }));
    expect(await screen.findByText(/目标路径已包含 openspec 项目/)).toBeTruthy();
  });
});
