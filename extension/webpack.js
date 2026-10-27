import TerserPlugin from 'terser-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';

import Dotenv from 'dotenv-webpack';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.join(__dirname, 'src');
const packageVersion = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

/**
 * Build da extensão — mesmo padrão de `pulsosocial_extension/webpack.js`.
 *
 * - `--env envFile=.env.dev` (pnpm dev) ou `.env` (pnpm build) é a ÚNICA fonte
 *   de URL/nome/flags: `Dotenv` substitui `process.env.X` no bundle. Nada de
 *   URL literal em `src/`.
 * - `--env store=true` (pnpm build:store): remove `key` do manifest (Web Store).
 * - Produção: Terser remove `console.*` e `debugger` (cinto e suspensório do
 *   guard `devLog`), sem comentários, sem source map.
 * - Desenvolvimento: source map barato, sem minificação, logs visíveis.
 */
export default (env = {}, argv = {}) => {
  const mode = argv.mode || 'production';
  const isProduction = mode === 'production';
  const isStoreBuild = env.store === 'true' || env.store === true;
  const envFile = env.envFile || '.env';

  const parsed = dotenv.config({ path: path.resolve(__dirname, envFile) }).parsed || {};
  const panelUrl = (parsed.PANEL_URL || '').replace(/\/+$/, '');
  const apiUrl = (parsed.API_URL || '').replace(/\/+$/, '');
  const devOrigins = (parsed.DEV_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const isDev = parsed.DEV === 'true';

  const buildExternallyConnectable = () => {
    const matches = [];
    if (panelUrl) {
      try {
        matches.push(new URL(panelUrl).origin + '/*');
      } catch { /* invalid PANEL_URL */ }
    }
    if (isDev) {
      for (const origin of devOrigins) {
        if (!matches.includes(origin.endsWith('/*') ? origin : origin + '/*')) {
          matches.push(origin.endsWith('/*') ? origin : origin + '/*');
        }
      }
    }
    return matches.length > 0 ? { matches } : undefined;
  };

  const buildHostPermissions = () => {
    const hosts = ['https://*.mercadolivre.com.br/*'];
    if (apiUrl) {
      try {
        const u = new URL(apiUrl);
        const apiHost = `${u.protocol}//${u.hostname}/*`;
        if (!hosts.includes(apiHost)) hosts.push(apiHost);
      } catch { /* invalid API_URL */ }
    }
    if (isDev) {
      try {
        const u = new URL(apiUrl);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          const localhostPattern = `${u.protocol}//${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}/*`;
          if (!hosts.includes(localhostPattern)) hosts.push(localhostPattern);
        }
      } catch { /* skip */ }
    }
    return hosts;
  };

  return {
    entry: {
      background: path.resolve(srcDir, 'background', 'index.ts'),
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      extensionAlias: { '.js': ['.ts', '.js'] },
    },
    module: {
      rules: [
        { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
      ],
    },
    mode,
    devtool: isProduction ? false : 'cheap-module-source-map',
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          extractComments: false,
          terserOptions: {
            compress: {
              pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn', 'console.error'],
              drop_debugger: true,
              passes: 2,
            },
            format: { comments: false },
          },
        }),
      ],
    },
    plugins: [
      new Dotenv({ path: envFile }),
      new CopyPlugin({
        patterns: [
          {
            from: '.',
            context: 'public',
            transform: (content, absolutePath) => {
              if (!absolutePath.endsWith('manifest.json')) return content;
              const manifest = JSON.parse(content.toString());

              manifest.version = packageVersion;

              delete manifest.content_scripts;

              const ec = buildExternallyConnectable();
              if (ec) manifest.externally_connectable = ec;

              manifest.host_permissions = buildHostPermissions();

              if (isStoreBuild) delete manifest.key;

              return Buffer.from(JSON.stringify(manifest, null, 2));
            },
          },
        ],
      }),
    ],
  };
};
