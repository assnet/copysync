/**
 * Verifies that `extension/src/contract/channel.ts` and
 * `app/src/features/extension/contract/channel.ts` are identical.
 *
 * Run as part of `type-check` in extension/package.json.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const monorepoRoot = resolve(root, '..');

const extPath = resolve(root, 'src/contract/channel.ts');
const appPath = resolve(monorepoRoot, 'app/src/features/extension/contract/channel.ts');

let exitCode = 0;

try {
  const extContent = readFileSync(extPath, 'utf8');
  const appContent = readFileSync(appPath, 'utf8');

  if (extContent !== appContent) {
    console.error('❌ channel.ts out of sync between extension/ and app/');
    console.error(`   extension: ${extPath}`);
    console.error(`   app:       ${appPath}`);
    console.error('   Copy one to the other and commit both.');
    exitCode = 1;
  } else {
    console.log('✅ channel.ts in sync');
  }
} catch (error) {
  console.error('❌ Cannot read contract files:', error.message);
  exitCode = 1;
}

process.exit(exitCode);
