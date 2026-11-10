import { vi } from 'vitest';

/** Stub mínimo de `chrome.*` para os testes do worker (storage em memória). */
export interface ChromeStub {
  storage: Record<string, unknown>;
  cookies: Record<string, Array<{ name: string; value: string; path: string; domain?: string }>>;
  granted: Set<string>;
  getAll: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  alarmsCreate: ReturnType<typeof vi.fn>;
  alarmsGet: ReturnType<typeof vi.fn>;
}

export const stubChrome = (): ChromeStub => {
  const stub = {
    storage: {} as Record<string, unknown>,
    cookies: {} as ChromeStub['cookies'],
    granted: new Set<string>(),
  } as ChromeStub;
  stub.getAll = vi.fn(async ({ url }: { url: string }) => stub.cookies[url] ?? []);
  stub.contains = vi.fn(async ({ origins }: { origins: string[] }) => origins.every(o => stub.granted.has(o)));
  // Concedida: registra as origens em `granted` (o estado pós-grant é o que o Chrome teria).
  stub.request = vi.fn(async ({ origins }: { origins: string[] }) => {
    origins.forEach(o => stub.granted.add(o));
    return true;
  });
  stub.remove = vi.fn(async ({ origins }: { origins: string[] }) => {
    const had = origins.some(o => stub.granted.has(o));
    origins.forEach(o => stub.granted.delete(o));
    return had;
  });
  stub.alarmsCreate = vi.fn(async () => undefined);
  stub.alarmsGet = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext-id-test', getManifest: () => ({ version: '3.4.0' }) },
    storage: {
      local: {
        get: async (key: string) => (key in stub.storage ? { [key]: stub.storage[key] } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(stub.storage, items); },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stub.storage[key];
        },
      },
    },
    cookies: { getAll: stub.getAll },
    permissions: { contains: stub.contains, request: stub.request, remove: stub.remove },
    alarms: { get: stub.alarmsGet, create: stub.alarmsCreate },
  });
  return stub;
};
