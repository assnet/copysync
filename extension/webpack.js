import TerserPlugin from 'terser-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import Dotenv from 'dotenv-webpack';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
 * - Produção: Terser remove `console.*` e `debugger` (cinto e suspensório do
 *   guard `devLog`), sem comentários, sem source map.
 * - Desenvolvimento: source map barato, sem minificação, logs visíveis.
 */
export default (env = {}, argv = {}) => {
  const mode = argv.mode || 'production';
  const isProduction = mode === 'production';
  const envFile = env.envFile || '.env';

  return {
    entry: {
      background: path.resolve(srcDir, 'background', 'index.ts'),
      content: path.resolve(srcDir, 'content', 'index.ts'),
      popup: path.resolve(srcDir, 'popup', 'index.ts'),
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
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        { test: /\.(png|svg|woff2?)$/i, type: 'asset/inline' },
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
            globOptions: { ignore: ['**/popup.html'] },
            // Mantém `version` do manifest igual ao `package.json` — fonte única.
            transform: (content, absolutePath) => {
              if (!absolutePath.endsWith('manifest.json')) return content;
              const manifest = JSON.parse(content.toString());
              manifest.version = packageVersion;
              return Buffer.from(JSON.stringify(manifest, null, 2));
            },
          },
        ],
      }),
      new HtmlWebpackPlugin({
        filename: 'popup.html',
        template: path.resolve(srcDir, 'popup', 'popup.html'),
        chunks: ['popup'],
        inject: 'body',
        minify: isProduction,
      }),
    ],
  };
};
