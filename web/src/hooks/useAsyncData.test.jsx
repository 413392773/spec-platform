import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useAsyncData } from './useAsyncData.js';

describe('useAsyncData', () => {
  it('挂载取数一次 → data/isPending 落定', async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: ['a'] });
    const { result } = renderHook(() => useAsyncData(fetcher));
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toEqual({ items: ['a'] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refresh() 重新取数并替换 data', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ items: ['a'] })
      .mockResolvedValue({ items: ['a', 'b'] });
    const { result } = renderHook(() => useAsyncData(fetcher));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toEqual({ items: ['a', 'b'] }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('取数失败 → error 文案', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('无法连接平台服务'));
    const { result } = renderHook(() => useAsyncData(fetcher));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.error).toBe('无法连接平台服务');
    expect(result.current.data).toBeNull();
  });
});
