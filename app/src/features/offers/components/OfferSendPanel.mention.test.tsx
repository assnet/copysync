import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OfferItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { OfferSendPanel } from './OfferSendPanel';

const t = offerStrings.actions;
const now = new Date().toISOString();
const offer = (over: Partial<OfferItem> = {}): OfferItem => ({
  id: 'o1', provider: 'AMAZON', sourceUrl: 'https://a', productRef: null, title: 'Fone', priceCents: null,
  originalPriceCents: null, imageUrl: null, affiliateUrl: 'https://a', attributionVerified: true, coupon: null,
  audience: 'STANDARD', mentionAll: false, imageMode: 'MEDIA', simulateTyping: false, typingSeconds: 15, scheduledAt: null, origin: 'GENERATOR', expiresAt: null,
  text: 'oferta', textEdited: false, status: 'DRAFT', createdAt: now, updatedAt: now, ...over,
});
const group = { conversationId: 'c-1', title: 'Grupo', avatarUrl: null, sessionId: 's1', canPost: true, postBlockedReason: null };

const renderPanel = (o: OfferItem, mentionLocked: boolean, onMentionAll = vi.fn()) => render(
  <MemoryRouter>
    <OfferSendPanel
      offer={o} groups={[group]} busy={false} sending={false} mentionSaving={false} imageModeSaving={false}
      mentionLocked={mentionLocked} sendBlocked={false} textTooLong={false} editing={false}
      onMentionAll={onMentionAll} onImageMode={vi.fn()} onTyping={vi.fn()} onSchedule={vi.fn()} onSend={vi.fn()}
    />
  </MemoryRouter>,
);

const mentionSwitch = () => screen.getByRole('checkbox', { name: t.mentionAll }) as HTMLInputElement;

describe('marcar todos x plano', () => {
  it('plano sem o recurso: desligado mesmo com a oferta marcada, travado, com tooltip e link de planos', async () => {
    renderPanel(offer({ mentionAll: true }), true);
    const sw = mentionSwitch();
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(true);
    expect(screen.getByText(t.mentionAllUnavailable)).toBeTruthy();
    expect(screen.getByRole('link', { name: t.mentionAllPlansLink }).getAttribute('href')).toBe('/affiliates/plans');
    fireEvent.mouseOver(sw.closest('label')!.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', t.mentionAllLocked);
  });

  it('plano com o recurso: habilitado, sem link de planos', () => {
    const onMentionAll = vi.fn();
    renderPanel(offer(), false, onMentionAll);
    const sw = mentionSwitch();
    expect(sw.disabled).toBe(false);
    expect(screen.getByText(t.mentionAllHelper)).toBeTruthy();
    expect(screen.queryByRole('link', { name: t.mentionAllPlansLink })).toBeNull();
    fireEvent.click(sw);
    expect(onMentionAll).toHaveBeenCalledWith(true);
  });
});
