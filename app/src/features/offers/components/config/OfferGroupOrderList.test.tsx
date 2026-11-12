import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionItem } from '@/types/api.types';
import { OfferGroupOrderList } from './OfferGroupOrderList';

const session = (id: string, name: string) => ({ id, name, status: 'CONNECTED', engine: 'BAILEYS' }) as unknown as SessionItem;
const g = (id: string, sessionId: string) => ({ id, title: `Grupo ${id}`, avatarUrl: null, sessionId, canPost: true, postBlockedReason: null });

describe('OfferGroupOrderList', () => {
  it('numera na ordem, setas movem e as pontas ficam desabilitadas', () => {
    const onMove = vi.fn();
    render(<OfferGroupOrderList sessions={[session('s1', 'A')]} groups={[g('a', 's1'), g('b', 's1')]} onMove={onMove} onRemove={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Enviar antes: Grupo a' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Enviar depois: Grupo b' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar antes: Grupo b' }));
    expect(onMove).toHaveBeenCalledWith('b', -1);
    expect(screen.getByRole('status').textContent).toBe('Grupo b agora é o 1º');
  });

  it('várias sessões: uma lista por sessão, numeração própria', () => {
    render(
      <OfferGroupOrderList
        sessions={[session('s1', 'A'), session('s2', 'B')]}
        groups={[g('a', 's1'), g('x', 's2'), g('b', 's1')]}
        onMove={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole('list', { name: 'Grupos de A' }).querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Grupos de B' }).querySelectorAll('li')).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Enviar depois: Grupo x' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
