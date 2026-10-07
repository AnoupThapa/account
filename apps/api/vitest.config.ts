import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { fileParallelism: false, testTimeout: 60000, hookTimeout: 120000, globalSetup: './test/global-setup.ts' },
});
