import { useCallback, useEffect, useState } from 'react';

/**
 * 挂载时执行一次异步取数 → { data, error, isPending, refresh }。
 * fetcher 必须是稳定引用（模块级导入的函数），带卸载守卫防 setState-after-unmount 竞态。
 * refresh() 触发重新取数（保留旧数据直到新数据到达，避免闪烁）。
 */
export function useAsyncData(fetcher) {
  const [state, setState] = useState({ data: null, error: null, isPending: true });
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let ignore = false;
    fetcher()
      .then((data) => {
        if (!ignore) setState({ data, error: null, isPending: false });
      })
      .catch((err) => {
        if (!ignore) setState({ data: null, error: err.message, isPending: false });
      });
    return () => {
      ignore = true;
    };
  }, [fetcher, reloadKey]);

  return { ...state, refresh };
}
