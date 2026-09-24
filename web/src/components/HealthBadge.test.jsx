import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HealthBadge from './HealthBadge.jsx';
import { getHealth } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  getHealth: vi.fn(),
}));

describe('HealthBadge 健康角标', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('环境正常时显示 openspec 版本', async () => {
    getHealth.mockResolvedValue({ ok: true, openspecVersion: '1.5.0' });
    render(<HealthBadge />);
    expect(await screen.findByText('openspec 1.5.0')).toBeTruthy();
  });

  it('后端不可用时显示环境异常', async () => {
    getHealth.mockRejectedValue(new Error('无法连接平台服务'));
    render(<HealthBadge />);
    expect(await screen.findByText('环境异常')).toBeTruthy();
  });

  it('检查中显示占位文案', () => {
    getHealth.mockReturnValue(new Promise(() => {}));
    render(<HealthBadge />);
    expect(screen.getByText('检查中…')).toBeTruthy();
  });
});
