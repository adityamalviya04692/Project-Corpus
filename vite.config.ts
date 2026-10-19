/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build works on any GitHub Pages project URL (/<repo>/).
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', '@mlc-ai/web-llm'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
