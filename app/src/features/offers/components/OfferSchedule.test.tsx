import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OfferDispatchItem, OfferItem } from '@/types/api.types';
import { OfferDispatchProgress } from './OfferDispatchProgress';
import { OfferSendPanel } from './OfferSendPanel';

const HOUR = 60 * 60_000;
const future = new Date(Date.now() + 2 * HOUR).toISOString();

const offer = (over: Partial<OfferItem> = {}): OfferItem => ({
  id: 'o1', provider: 'AMAZON', sourceUrl: 'https://a', productRef: null, title: 'Fone', priceCents: null,
  originalPriceCents: null, imageUrl: null, affiliateUrl: 'https://a', attributionVerified: true, coupon: null,
  audience: 'STANDARD', mentionAll: false, simulateTyping: false, typingSeconds: 15, scheduledAt: null,
  text: 'oferta', textEdited: false, status: 'DRAFT', createdAt: future, updatedAt: new Date().toISOString(), ...over,
});

const dispatch = (id: string, notBefore: string): OfferDispatchItem => ({
  id, conversationId: `c-${id}`, status: 'QUEUED', notBefore, chatMessageId: null, failureReason: null, updatedAt: notBefore,
});

const group = { conversationId: 'c-1', title: 'Grupo', avatarUrl: null, sessionId: 's1' };

const panel = (o: OfferItem) => (
  <OfferSendPanel
    offer={o} groups={[group, { ...group, conversationId: 'c-2' }]} busy={false} sending={false} mentionSaving={false}
    mentionUnavailable={false} sendBlocked={false} textTooLong={false} editing={false}
    onMentionAll={vi.fn()} onTyping={vi.fn()} onSchedule={vi.fn().mockResolvedValue(undefined)} onSend={vi.fn()}
  />
);

describe('agendamento do início', () => {
  it('card de envio: sem agendamento dispara; com horário futuro vira "Agendar"', () => {
    const { unmount } = render(panel(offer()));
    expect(screen.getByRole('button', { name: /Disparar nos 2 grupos/ })).toBeTruthy();
    unmount();
    render(panel(offer({ id: 'o2', scheduledAt: future })));
    expect(screen.getByRole('button', { name: /Agendar para 2 grupos/ })).toBeTruthy();
  });

  it('progresso antes do início mostra "Envio agendado" e a contagem até o início', () => {
    render(
      <OfferDispatchProgress
        status="SENDING" scheduledAt={future} updatedAt={new Date().toISOString()}
        dispatches={[dispatch('1', future), dispatch('2', future)]} destinations={[group]} sessions={[]}
      />,
    );
    expect(screen.getByText(/Envio agendado/)).toBeTruthy();
    expect(screen.getByLabelText('Tempo até o início do envio')).toBeTruthy();
    expect(screen.queryByLabelText('Tempo até o próximo envio')).toBeNull();
  });
});
