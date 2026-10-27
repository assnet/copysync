import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '../config/env.js': './src/__mocks__/env.ts',
      '../../config/env.js': './src/__mocks__/env.ts',
    },
  },
});
