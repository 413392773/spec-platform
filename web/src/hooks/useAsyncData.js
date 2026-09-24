import { useEffect, useState } from 'react';

/**
 * 挂载时执行一次异步取数 → { data, error, isPending }。
 * fetcher 必须是稳定引用（模块级导入的函数），带卸载守卫防 setState-after-unmount 竞态。
 */
export function useAsyncData(fetcher) {
  const [state, setState] = useState({ data: null, error: null, isPending: true });

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
  }, [fetcher]);

  return state;
}
