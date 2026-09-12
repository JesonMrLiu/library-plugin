import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // smoke.test.ts spawn dist 产物，需要先 build；其余单测纯函数零依赖
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
