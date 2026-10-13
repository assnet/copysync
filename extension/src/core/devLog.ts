import { env } from '../config/env.js';

/**
 * Log só em desenvolvimento. Em produção o gate colapsa para no-op e o Terser
 * (`pure_funcs`) ainda remove qualquer `console.*` que escape.
 */
export const devLog = (...args: unknown[]): void => {
  if (env.isDev) console.log(`[${env.appName}]`, ...args);
};

export const devError = (...args: unknown[]): void => {
  if (env.isDev) console.error(`[${env.appName}]`, ...args);
};
