import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const client = vi.hoisted(() => ({
  sendOp: vi.fn(),
  detectExtension: vi.fn(),
  isExtensionApiAvailable: vi.fn(),
  getCachedExtId: vi.fn(() => 'ext-id'),
  clearCachedExtId: vi.fn(),
}));
vi.mock('../channel/client', () => client);

const api = vi.hoisted(() => ({
  getCredentialStatuses: vi.fn(),
  consent: vi.fn(),
  disconnect: vi.fn(),
  issueSession: vi.fn(),
  revokeSession: vi.fn(),
}));
vi.mock('../services/extensionApi', () => ({ extensionApi: api }));
vi.mock('@/services/serverClock', () => ({ serverNow: () => Date.parse('2026-11-10T12:00:00.000Z') }));

import { useExtension, ExtensionSyncError } from './useExtension';

const cred = (provider: string, over: Record<string, unknown> = {}) => ({
  provider, status: 'ACTIVE', hasSession: true, sessionInvalidAt: null, publicIdentifier: 'x',
  lastSyncAt: '2026-11-10T12:00:01.000Z', rejectedAt: null, ...over,
});

function handshake(caps: string[]) {
  return { ok: true, payload: { extVersion: '3.4.0', contractVersion: 1, caps, authenticated: true, installationId: 'inst-1' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.isExtensionApiAvailable.mockReturnValue(true);
  client.detectExtension.mockResolvedValue(true);
  api.getCredentialStatuses.mockResolvedValue({ ml: null, shein: null });
});

async function mount(caps = ['shein.session'], ops: Record<string, unknown> = {}) {
  client.sendOp.mockImplementation(async (op: string) => {
    if (op === 'handshake') return handshake(caps);
    if (op in ops) return ops[op];
    return { ok: true, payload: {} };
  });
  const h = renderHook(() => useExtension());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

describe('useExtension', () => {
  it('supports(cap) lê as capacidades do handshake', async () => {
    const h = await mount(['shein.session']);
    expect(h.result.current.supports('shein.session')).toBe(true);
    expect(h.result.current.supports('outra')).toBe(false);
  });

  it('sync Shein é julgado pela credencial SHEIN, não pela do ML', async () => {
    // ML recusada; Shein gravada agora e aceita → sync Shein ok
    api.getCredentialStatuses.mockResolvedValue({
      ml: cred('MERCADO_LIVRE', { rejectedAt: '2026-11-10T11:00:00.000Z' }),
      shein: cred('SHEIN'),
    });
    const h = await mount(['shein.session'], { 'shein.syncSession': { ok: true, payload: { result: 'FAILED', errorCode: 'api_unreachable' } } });

    // Servidor já gravou a Shein (lastSyncAt depois do clique): vale o salvo, mesmo com FAILED da extensão
    await act(async () => { await expect(h.result.current.sync('shein')).resolves.toBeTruthy(); });
    expect(client.sendOp).toHaveBeenCalledWith('shein.syncSession');
    // Shein não concede consentimento no sync
    expect(api.consent).not.toHaveBeenCalled();
  });

  it('sync Shein falha pela credencial SHEIN mesmo com o ML em dia', async () => {
    api.getCredentialStatuses.mockResolvedValue({ ml: cred('MERCADO_LIVRE'), shein: null });
    const h = await mount(['shein.session'], { 'shein.syncSession': { ok: true, payload: { result: 'FAILED', errorCode: 'shein_not_logged' } } });
    let err: unknown;
    await act(async () => { err = await h.result.current.sync('shein').catch((e) => e); });
    expect(err).toBeInstanceOf(ExtensionSyncError);
    expect((err as ExtensionSyncError).code).toBe('shein_not_logged');
  });

  it('disconnect e consent usam a rota do marketplace', async () => {
    api.getCredentialStatuses.mockResolvedValue({ ml: null, shein: null });
    const h = await mount();
    await act(async () => { await h.result.current.consent('shein'); });
    expect(api.consent).toHaveBeenCalledWith('shein', 'inst-1');
    await act(async () => { await h.result.current.disconnect('shein'); });
    expect(api.disconnect).toHaveBeenCalledWith('shein');
  });

  it('refreshSeq sobe a cada refresh concluído e shein.status só com a capacidade', async () => {
    api.getCredentialStatuses.mockResolvedValue({ ml: null, shein: null });
    const h = await mount([]);
    const seq = h.result.current.refreshSeq;
    expect(client.sendOp).not.toHaveBeenCalledWith('shein.status');
    await act(async () => { await h.result.current.refresh(); });
    expect(h.result.current.refreshSeq).toBe(seq + 1);
  });
});
