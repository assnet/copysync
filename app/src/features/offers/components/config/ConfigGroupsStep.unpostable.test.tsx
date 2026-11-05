import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OfferConfigResponse, SessionGroupWithSession, SessionItem } from '@/types/api.types';
import { ConfigGroupsStep } from './ConfigGroupsStep';
import { ConfigConfirmStep } from './ConfigConfirmStep';

const groups: SessionGroupWithSession[] = [
  { groupJid: 'g1', title: 'Liberado', avatarUrl: null, conversationId: 'c1', sessionId: 's1', canPost: true },
  { groupJid: 'g2', title: 'Só admins', avatarUrl: null, conversationId: 'c2', sessionId: 's1', canPost: false, postBlockedReason: 'ADMINS_ONLY' },
];

vi.mock('../../hooks/useSessionGroups', () => ({
  useSessionGroups: () => ({ items: groups, partial: false, loading: false, failed: false, retry: vi.fn() }),
}));

const session = { id: 's1', name: 'Sessão', engine: 'BAILEYS', status: 'CONNECTED', avatarUrl: null } as unknown as SessionItem;
const limits: OfferConfigResponse['limits'] = {
  whatsapp: { sessions: null, broadcastGroups: null },
  telegram: { sessions: null, broadcastGroups: null },
};

const renderStep = (onToggle = vi.fn()) =>
  render(<ConfigGroupsStep sessions={[session]} selected={new Map()} limits={limits} catalog={null} onToggle={onToggle} onClear={vi.fn()} />);

describe('grupos onde a sessão não posta', () => {
  beforeEach(() => sessionStorage.clear());

  it('ligado (padrão): oculta e conta 1 oculto', () => {
    renderStep();
    expect(screen.queryByText('Só admins')).toBeNull();
    expect(screen.getByText('1 oculto')).toBeTruthy();
  });

  it('desligado: aparece com motivo, sem marcar ao clicar', () => {
    const onToggle = vi.fn();
    renderStep(onToggle);
    fireEvent.click(screen.getByRole('checkbox', { name: /Ocultar grupos onde não posso postar/ }));
    expect(screen.getByText('Só admins podem enviar')).toBeTruthy();
    const card = screen.getAllByRole('checkbox').find((el) => el.getAttribute('aria-disabled') === 'true');
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('confirmar: grupo salvo bloqueado ganha alerta e "Remover"', () => {
    const onRemove = vi.fn();
    render(
      <ConfigConfirmStep
        sessions={[session]}
        groups={[{ id: 'c2', title: 'Só admins', avatarUrl: null, sessionId: 's1', canPost: false, postBlockedReason: 'ADMINS_ONLY' }]}
        onRemoveGroup={onRemove}
        intervalMin={300} intervalMax={600} onInterval={vi.fn()} dispatchOrder="SEQUENTIAL" onDispatchOrder={vi.fn()}
        postingWindow={{ window: { lo: 0, hi: 1440, overnight: false }, weekdaysMask: 127 }}
      />,
    );
    expect(screen.getByText(/1 grupo não vai receber envios/)).toBeTruthy();
    expect(screen.getByText('Envio bloqueado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect(onRemove).toHaveBeenCalledWith('c2');
  });

  it('confirmar: canPost null não avisa', () => {
    render(
      <ConfigConfirmStep
        sessions={[session]}
        groups={[{ id: 'c3', title: 'X', avatarUrl: null, sessionId: 's1', canPost: null, postBlockedReason: null }]}
        onRemoveGroup={vi.fn()}
        intervalMin={300} intervalMax={600} onInterval={vi.fn()} dispatchOrder="SEQUENTIAL" onDispatchOrder={vi.fn()}
        postingWindow={{ window: { lo: 0, hi: 1440, overnight: false }, weekdaysMask: 127 }}
      />,
    );
    expect(screen.queryByText('Envio bloqueado')).toBeNull();
  });
});
