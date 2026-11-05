import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import type { BroadcastGroupCatalogItem, BroadcastGroupsResponse } from '@/types/api.types';
import { BROADCAST_GROUPS_FILTERS_KEY, BroadcastGroupsTable, filterBroadcastGroups } from './BroadcastGroupsTable';

const item = (id: string, over: Partial<BroadcastGroupCatalogItem> = {}): BroadcastGroupCatalogItem => ({
  conversationId: id, sessionId: 's1', channel: 'whatsapp', title: `Grupo ${id}`, avatarUrl: null, usedBy: ['generator'], ...over,
});
const data = (items: BroadcastGroupCatalogItem[], wa = 5, tg: number | null = 10): BroadcastGroupsResponse => ({
  items,
  limits: { whatsapp: { broadcastGroups: wa }, telegram: { broadcastGroups: tg } },
  usage: {
    whatsapp: { broadcastGroups: items.filter((i) => i.channel === 'whatsapp').length },
    telegram: { broadcastGroups: items.filter((i) => i.channel === 'telegram').length },
  },
});
const names: Record<string, string> = { s1: 'Loja Centro', s2: 'Canal Promo' };
const sessionNameOf = (id: string) => names[id] ?? null;

const ITEMS = [
  item('a', { title: 'Promoções Ação', usedBy: ['generator', 'monitor:s1'] }),
  item('b', { title: 'Achadinhos', sessionId: 's2', channel: 'telegram', usedBy: ['monitor:s2'] }),
];

function setup(mode: 'light' | 'dark' = 'light', d = data(ITEMS), onRemove = vi.fn(async () => undefined)) {
  renderWithTheme(
    <PrivacyProvider>
      <BroadcastGroupsTable data={d} sessionNameOf={sessionNameOf} removing={null} onRemove={onRemove} />
    </PrivacyProvider>,
    mode,
  );
  return { onRemove };
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe('filterBroadcastGroups', () => {
  it('filtra por canal e busca sem acento no grupo ou na sessão', () => {
    expect(filterBroadcastGroups(ITEMS, { channel: 'telegram', query: '' }, sessionNameOf).map((g) => g.conversationId)).toEqual(['b']);
    expect(filterBroadcastGroups(ITEMS, { channel: 'all', query: 'acao' }, sessionNameOf).map((g) => g.conversationId)).toEqual(['a']);
    expect(filterBroadcastGroups(ITEMS, { channel: 'all', query: 'PROMO' }, sessionNameOf).map((g) => g.conversationId)).toEqual(['a', 'b']);
  });
});

describe.each(['light', 'dark'] as const)('BroadcastGroupsTable (%s)', (mode) => {
  it('mostra chips n/limite, linhas e uso por item', () => {
    setup(mode);
    expect(screen.getByLabelText('1 grupo de disparo no WhatsApp de 5 do plano')).toBeInTheDocument();
    expect(screen.getByText('Telegram 1/10')).toBeInTheDocument();
    expect(screen.getByText('Promoções Ação')).toBeInTheDocument();
    expect(screen.getByText('Gerador de ofertas')).toBeInTheDocument();
    expect(screen.getByText('Monitoramento · Loja Centro')).toBeInTheDocument();
    expect(screen.getByText('2 grupos')).toBeInTheDocument();
  });

  it('busca persiste na aba (escopo tab) e "Limpar filtros" volta tudo', () => {
    setup(mode);
    fireEvent.change(screen.getByLabelText('Buscar grupo de disparo pelo nome do grupo ou da sessão'), { target: { value: 'achad' } });
    expect(screen.queryByText('Promoções Ação')).toBeNull();
    expect(screen.getByText('Achadinhos')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(`ui.${BROADCAST_GROUPS_FILTERS_KEY}`)!).d).toEqual({ channel: 'all', query: 'achad' });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByText('Promoções Ação')).toBeInTheDocument();
    expect(sessionStorage.getItem(`ui.${BROADCAST_GROUPS_FILTERS_KEY}`)).toBeNull();
  });

  it('filtro salvo na aba é restaurado no reload', () => {
    sessionStorage.setItem(`ui.${BROADCAST_GROUPS_FILTERS_KEY}`, JSON.stringify({ v: 0, d: { channel: 'telegram', query: '' } }));
    setup(mode);
    expect(screen.queryByText('Promoções Ação')).toBeNull();
    expect(screen.getByText('Achadinhos')).toBeInTheDocument();
  });

  it('busca sem resultado mostra estado vazio de filtro', () => {
    setup(mode);
    fireEvent.change(screen.getByLabelText('Buscar grupo de disparo pelo nome do grupo ou da sessão'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhum grupo encontrado')).toBeInTheDocument();
  });

  it('remover pede confirmação e chama onRemove', async () => {
    const { onRemove } = setup(mode);
    fireEvent.click(screen.getByRole('button', { name: 'Remover o grupo Promoções Ação de todos os usos' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/todos os 2 usos/)).toBeInTheDocument();
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Remover de todos' })));
    expect(onRemove).toHaveBeenCalledWith('a');
    expect(await screen.findByText('Promoções Ação foi removido dos grupos de disparo.')).toBeInTheDocument();
  });

  it('cancelar não remove; erro mostra aviso', async () => {
    const onRemove = vi.fn(async () => { throw new Error('x'); });
    setup(mode, data(ITEMS), onRemove);
    fireEvent.click(screen.getByRole('button', { name: 'Remover o grupo Achadinhos de todos os usos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onRemove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Remover o grupo Achadinhos de todos os usos' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remover de todos' })));
    expect(await screen.findByText('Não foi possível remover o grupo. Tente de novo.')).toBeInTheDocument();
  });
});

describe('BroadcastGroupsTable — privacidade e limites', () => {
  it('desfoque borra nome do grupo e da sessão e tira a sessão do chip de uso', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['broadcastGroups.groupNames', 'broadcastGroups.sessionName']));
    setup();
    expect(screen.getByText('Promoções Ação').closest('[data-blurred="true"]')).not.toBeNull();
    for (const el of screen.getAllByText('Loja Centro')) expect(el.closest('[data-blurred="true"]')).not.toBeNull();
    expect(screen.queryByText('Monitoramento · Loja Centro')).toBeNull();
    expect(screen.getAllByText('Monitoramento').length).toBeGreaterThan(0);
  });

  it('canal com limite 0 e sem uso some dos chips; acima do limite avisa', () => {
    const wa = [item('a'), item('b'), item('c')];
    setup('light', data(wa, 2, 0));
    expect(screen.queryByText(/^Telegram \d/)).toBeNull();
    expect(screen.getByText('WhatsApp 3/2')).toBeInTheDocument();
    expect(screen.getByText(/passou do limite de grupos do WhatsApp/)).toBeInTheDocument();
  });

  it('lista vazia mostra estado vazio', () => {
    setup('light', data([]));
    expect(screen.getByText('Nenhum grupo de disparo ainda')).toBeInTheDocument();
  });
});
