import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vitest do painel.
 *
 * Testes co-locados (`Componente.test.tsx` ao lado do componente). Ambiente jsdom com
 * Testing Library — os testes exercitam o que o operador vê e clica, não detalhes internos
 * de estado.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
