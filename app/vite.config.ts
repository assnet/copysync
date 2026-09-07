/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Versão exibida no painel — lida do package.json para não duplicar a fonte da verdade.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:3333';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      host: true,
      port: 5174,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          ws: true,
        },
      },
    },
    // Vitest mora aqui, e não em vitest.config.ts, para herdar `define`, `resolve.alias`
    // e plugins desta configuração. Separado, o teste resolvia módulos por um alias
    // paralelo e rodava sem `__APP_VERSION__` — qualquer componente que exiba a versão
    // quebrava só no teste.
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      clearMocks: true,
      restoreMocks: true,
    },
  };
});
