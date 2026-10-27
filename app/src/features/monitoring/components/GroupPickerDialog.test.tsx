import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const listSessionGroups = vi.fn();
vi.mock('@/services/offer.service', () => ({ offerService: { listSessionGroups: (id: string, q?: string) => listSessionGroups(id, q) } }));

import { GroupPickerDialog, KEYWORDS_PER_GROUP, KEYWORD_MAX_LENGTH, normalizeKeywords } from './GroupPickerDialog';
import { canRetryCaptured } from './CapturedOffersList';

beforeEach(() => {
  sessionStorage.clear();
  listSessionGroups.mockReset();
  listSessionGroups.mockResolvedValue({ groups: [], partial: false });
});

describe('normalizeKeywords', () => {
  it('corta no tamanho e na quantidade da API, sem repetidas', () => {
    const long = 'x'.repeat(60);
    expect(normalizeKeywords([` ${long} `])[0]).toHaveLength(KEYWORD_MAX_LENGTH);
    expect(normalizeKeywords(['Fone', 'fone', ' '])).toEqual(['Fone']);
    expect(normalizeKeywords(Array.from({ length: 30 }, (_, i) => `k${i}`))).toHaveLength(KEYWORDS_PER_GROUP);
  });
});

describe('GroupPickerDialog', () => {
  it('rascunho da aba guarda só groupJid e palavras-chave (sem nome/foto do servidor)', async () => {
    render(
      <GroupPickerDialog
        mode="monitored"
        sessionId="s1"
        initial={[{ groupJid: 'g1@g.us', title: 'Promo Rival', avatarUrl: 'https://x/a.jpg', keywords: ['fone'] }]}
        max={5}
        excludeJids={[]}
        onClose={() => undefined}
        onSave={async () => undefined}
      />,
    );
    expect(await screen.findByText('Promo Rival')).toBeInTheDocument();
    expect(screen.getByText('1/20 palavras-chave')).toBeInTheDocument();
    const raw = sessionStorage.getItem('ui.monitoring.picker.monitored.s1') ?? '';
    expect(JSON.parse(raw).d).toEqual([{ groupJid: 'g1@g.us', keywords: ['fone'] }]);
    expect(raw).not.toContain('Promo Rival');
  });
});

describe('canRetryCaptured', () => {
  it('aceita os motivos recuperáveis da API, inclusive monitoramento desligado', () => {
    expect(canRetryCaptured({ status: 'SKIPPED', reason: 'MONITOR_DISABLED' })).toBe(true);
    expect(canRetryCaptured({ status: 'FAILED', reason: 'INTERNAL_ERROR' })).toBe(true);
    expect(canRetryCaptured({ status: 'SKIPPED', reason: 'EXPIRED' })).toBe(false);
    expect(canRetryCaptured({ status: 'QUEUED', reason: null })).toBe(false);
  });
});
