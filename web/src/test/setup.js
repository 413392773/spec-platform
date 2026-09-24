import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest 未开 globals，RTL 不会自动清理；每个用例后卸载 DOM，避免跨用例污染
afterEach(() => {
  cleanup();
});
