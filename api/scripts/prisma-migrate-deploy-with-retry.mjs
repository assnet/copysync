import { spawn } from 'node:child_process';

const maxAttempts = Number.parseInt(process.env.PRISMA_DEPLOY_MAX_ATTEMPTS ?? '5', 10);
const retryDelayMs = Number.parseInt(process.env.PRISMA_DEPLOY_RETRY_DELAY_MS ?? '5000', 10);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runMigrateDeploy() {
  return new Promise((resolve) => {
    const child = spawn('node_modules/.bin/prisma', ['migrate', 'deploy'], {
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error('[prisma:deploy] failed to start prisma migrate deploy', err);
      resolve(1);
    });
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  console.log(`[prisma:deploy] attempt ${attempt}/${maxAttempts}`);
  const code = await runMigrateDeploy();

  if (code === 0) {
    process.exit(0);
  }

  if (attempt < maxAttempts) {
    console.warn(`[prisma:deploy] failed with exit code ${code}; retrying in ${retryDelayMs}ms`);
    await wait(retryDelayMs);
  } else {
    console.error(`[prisma:deploy] failed after ${maxAttempts} attempts`);
    process.exit(code);
  }
}
