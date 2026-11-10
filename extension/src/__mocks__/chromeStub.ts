import { vi } from 'vitest';

/** Stub mínimo de `chrome.*` para os testes do worker (storage em memória). */
export interface ChromeStub {
  storage: Record<string, unknown>;
  cookies: Record<string, Array<{ name: string; value: string; path: string }>>;
  granted: Set<string>;
  getAll: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

export const stubChrome = (): ChromeStub => {
  const stub = {
    storage: {} as Record<string, unknown>,
    cookies: {} as ChromeStub['cookies'],
    granted: new Set<string>(),
  } as ChromeStub;
  stub.getAll = vi.fn(async ({ url }: { url: string }) => stub.cookies[url] ?? []);
  stub.contains = vi.fn(async ({ origins }: { origins: string[] }) => origins.every(o => stub.granted.has(o)));
  stub.request = vi.fn(async () => true);
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext-id-test', getManifest: () => ({ version: '3.4.0' }) },
    storage: {
      local: {
        get: async (key: string) => (key in stub.storage ? { [key]: stub.storage[key] } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(stub.storage, items); },
        remove: async (key: string) => { delete stub.storage[key]; },
      },
    },
    cookies: { getAll: stub.getAll },
    permissions: { contains: stub.contains, request: stub.request },
    alarms: { get: vi.fn(async () => undefined), create: vi.fn(async () => undefined) },
  });
  return stub;
};
