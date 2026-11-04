import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OfferDispatchItem, OfferItem } from '@/types/api.types';
import { OfferDispatchProgress } from './OfferDispatchProgress';
import { OfferSendPanel } from './OfferSendPanel';

const HOUR = 60 * 60_000;
const future = new Date(Date.now() + 2 * HOUR).toISOString();

const offer = (over: Partial<OfferItem> = {}): OfferItem => ({
  id: 'o1', provider: 'AMAZON', sourceUrl: 'https://a', productRef: null, title: 'Fone', priceCents: null,
  originalPriceCents: null, imageUrl: null, affiliateUrl: 'https://a', attributionVerified: true, coupon: null,
  audience: 'STANDARD', mentionAll: false, imageMode: 'MEDIA', simulateTyping: false, typingSeconds: 15, scheduledAt: null, origin: 'GENERATOR', expiresAt: null,
  text: 'oferta', textEdited: false, status: 'DRAFT', createdAt: future, updatedAt: new Date().toISOString(), ...over,
});

const dispatch = (id: string, notBefore: string): OfferDispatchItem => ({
  id, conversationId: `c-${id}`, status: 'QUEUED', notBefore, chatMessageId: null, failureReason: null, waitingSession: false, updatedAt: notBefore,
});

const group = { conversationId: 'c-1', title: 'Grupo', avatarUrl: null, sessionId: 's1', canPost: true, postBlockedReason: null };

const panel = (o: OfferItem) => (
  <OfferSendPanel
    offer={o} groups={[group, { ...group, conversationId: 'c-2' }]} busy={false} sending={false} mentionSaving={false} imageModeSaving={false}
    mentionUnavailable={false} sendBlocked={false} textTooLong={false} editing={false}
    onMentionAll={vi.fn()} onImageMode={vi.fn()} onTyping={vi.fn()} onSchedule={vi.fn().mockResolvedValue(undefined)} onSend={vi.fn()}
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

describe('formato da imagem', () => {
  it('mostra o formato salvo e avisa a troca para prévia do link', () => {
    const onImageMode = vi.fn();
    render(
      <OfferSendPanel
        offer={offer()} groups={[group]} busy={false} sending={false} mentionSaving={false} imageModeSaving={false}
        mentionUnavailable={false} sendBlocked={false} textTooLong={false} editing={false}
        onMentionAll={vi.fn()} onImageMode={onImageMode} onTyping={vi.fn()} onSchedule={vi.fn()} onSend={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Imagem com legenda/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Prévia do link/ }));
    expect(onImageMode).toHaveBeenCalledWith('LINK_PREVIEW');
  });

  it('prévia do link sem foto avisa que sai como texto; com foto, não', () => {
    const { unmount } = render(panel(offer({ imageMode: 'LINK_PREVIEW' })));
    expect(screen.getByText('Sem foto: a oferta sai como texto, sem prévia.')).toBeTruthy();
    unmount();
    render(panel(offer({ imageMode: 'LINK_PREVIEW', imageUrl: 'https://cdn/p.jpg' })));
    expect(screen.queryByText(/Sem foto: a oferta sai como texto/)).toBeNull();
  });
});
