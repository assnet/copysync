import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const envMock = fileURLToPath(new URL('./src/__mocks__/env.ts', import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '../config/env.js': envMock,
      '../../config/env.js': envMock,
    },
  },
});
