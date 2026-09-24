import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': API_TARGET,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
  },
});
