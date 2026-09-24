import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HomePage from './HomePage.jsx';
import { getSchemas } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  getSchemas: vi.fn(),
}));

const SCHEMAS = [
  {
    name: 'spec-large-self',
    label: '大项目模式',
    hint: '我要做一个完整的产品',
    version: 2,
    default: true,
  },
];

describe('HomePage 模式选择', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染模式卡片：标签、提示与推荐徽标', async () => {
    getSchemas.mockResolvedValue(SCHEMAS);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('大项目模式')).toBeTruthy();
    expect(screen.getByText('推荐')).toBeTruthy();
    expect(screen.getByText('我要做一个完整的产品')).toBeTruthy();
  });

  it('加载中显示占位文案', () => {
    getSchemas.mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByText('加载中…')).toBeTruthy();
  });

  it('加载失败显示错误横幅', async () => {
    getSchemas.mockRejectedValue(new Error('无法连接平台服务'));
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/无法连接平台服务/)).toBeTruthy();
  });

  it('点击"选这个模式"跳转向导页', async () => {
    getSchemas.mockResolvedValue(SCHEMAS);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/wizard/:mode" element={<div>向导页占位</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '选这个模式' }));
    expect(await screen.findByText('向导页占位')).toBeTruthy();
  });
});
