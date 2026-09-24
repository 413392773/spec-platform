import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import App from './App.jsx';

describe('App 骨架', () => {
  it('渲染顶栏品牌名', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/小白开发平台/)).toBeTruthy();
  });

  it('首页路由渲染模式选择标题', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '选择开发模式' })).toBeTruthy();
  });

  it('项目列表路由渲染', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '我的项目' })).toBeTruthy();
  });

  it('未知路由渲染 404 页（L6 回归）', () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeTruthy();
  });
});
