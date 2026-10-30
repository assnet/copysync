import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { buildTheme } from '@/theme/theme';
import type { BroadcastGroupItem } from '@/types/api.types';
import { BroadcastGroupsCard, reinsertGroup } from './BroadcastGroupsCard';

const g = (jid: string, position: number): BroadcastGroupItem => ({ conversationId: `c-${jid}`, groupJid: jid, sessionId: 's1', title: `Grupo ${jid}`, avatarUrl: null, position });
const refs = (...jids: string[]) => jids.map((groupJid) => ({ groupJid, sessionId: 's1' }));

function setup(initial: BroadcastGroupItem[]) {
  const onChange = vi.fn(async () => undefined);
  const props = { used: initial.length, max: 10, monitorSessionId: 's1', sessionNameOf: () => null, onAdd: vi.fn(), onChange };
  // `wrapper` mantém o tema no rerender (sem remontar o card e perder o estado do desfazer)
  const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider theme={buildTheme('light')}>{children}</ThemeProvider>;
  const view = render(<BroadcastGroupsCard {...props} groups={initial} />, { wrapper });
  const rerender = (groups: BroadcastGroupItem[]) => view.rerender(<BroadcastGroupsCard {...props} groups={groups} />);
  return { onChange, rerender, props };
}

describe('reinsertGroup', () => {
  it('insere na posição salva da lista atual, limitada ao tamanho e sem duplicar', () => {
    expect(reinsertGroup(refs('a', 'c'), refs('b')[0]!, 1)).toEqual(refs('a', 'b', 'c'));
    expect(reinsertGroup(refs('a'), refs('b')[0]!, 5)).toEqual(refs('a', 'b'));
    expect(reinsertGroup(refs('a', 'b'), refs('b')[0]!, 0)).toEqual(refs('b', 'a'));
  });
});

describe('BroadcastGroupsCard — desfazer remoção', () => {
  it('desfazer devolve só o grupo removido à lista atual', async () => {
    const { onChange, rerender } = setup([g('a', 0), g('b', 1), g('c', 2)]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remover da lista: Grupo b' })));
    expect(onChange).toHaveBeenLastCalledWith(refs('a', 'c'));
    rerender([g('a', 0), g('c', 1)]);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Desfazer' })));
    expect(onChange).toHaveBeenLastCalledWith(refs('a', 'b', 'c'));
  });

  it('lista mudada por outro caminho (seletor) cancela o desfazer', async () => {
    const { rerender } = setup([g('a', 0), g('b', 1)]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remover da lista: Grupo b' })));
    rerender([g('a', 0)]);
    expect(await screen.findByRole('button', { name: 'Desfazer' })).toBeInTheDocument();
    rerender([g('a', 0), g('d', 1)]);
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull());
  });

  it('reordenar depois de remover cancela o desfazer', async () => {
    const { rerender } = setup([g('a', 0), g('b', 1), g('c', 2)]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remover da lista: Grupo b' })));
    rerender([g('a', 0), g('c', 1)]);
    expect(await screen.findByRole('button', { name: 'Desfazer' })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enviar depois: Grupo a' })));
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull());
  });
});
