import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import type { Rotation, RotationOverview } from '../types';
import { linkRotationStrings } from '../strings';
import { finalizeSlug, normalizeSlugInput } from '../slug';

const svc = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), rename: vi.fn() }));
vi.mock('@/services/linkRotation.service', () => ({ linkRotationService: svc }));

import { RotationConfigDialog } from '../components/RotationConfigDialog';

const t = linkRotationStrings.config;

const overview: RotationOverview = {
  rotations: [],
  domains: [{ id: 'd1', hostname: 'copysync.com.br' }],
  limits: { linkRotations: 3, linkRotationGroups: 5 },
  sessions: [
    { id: 's1', name: 'Loja', status: 'CONNECTED' },
    { id: 's2', name: 'Reserva', status: 'DISCONNECTED' },
  ],
};

const group = {
  id: 'g1', conversationId: null, groupJid: '1@g.us', groupName: 'G', position: 0, weight: 1, capacity: 1000,
  inviteUrl: null, linkSource: null, status: 'ACTIVE' as const, memberCount: null, memberCountAt: null,
  clicksSinceSync: 0, clickCount: 0, lastClickAt: null,
};
const rotation: Rotation = {
  id: 'r1', sessionId: 's1', domainId: 'd1', hostname: 'copysync.com.br', slug: 'promo',
  publicUrl: 'https://promo.copysync.com.br', status: 'ACTIVE', strategy: 'BALANCED', title: null,
  clickCount: 0, lastClickAt: null, allFullNotifiedAt: null, createdAt: '', updatedAt: '', groups: [group, { ...group, id: 'g2' }],
};

const setup = (props: Partial<Parameters<typeof RotationConfigDialog>[0]> = {}, mode: 'light' | 'dark' = 'light') => {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onPlanLimit: vi.fn() };
  renderWithTheme(
    <PrivacyProvider>
      <RotationConfigDialog open overview={overview} {...handlers} {...props} />
    </PrivacyProvider>,
    mode,
  );
  return handlers;
};
const slugInput = () => screen.getByRole('textbox', { name: new RegExp(t.slug) });
const preview = () => screen.getByTestId('rotation-link-preview');

describe('normalização do nome', () => {
  it('minúsculo, sem acento, espaço vira hífen, só a-z0-9-', () => {
    expect(normalizeSlugInput('Ofertas da Ána!')).toBe('ofertas-da-ana');
    expect(normalizeSlugInput('  --Loja__VIP  ')).toBe('loja-vip-');
    expect(normalizeSlugInput('a'.repeat(60))).toHaveLength(50);
    expect(finalizeSlug('loja-vip-')).toBe('loja-vip');
  });
});

describe('RotationConfigDialog', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.values(svc).forEach((f) => f.mockReset());
  });

  it('normaliza ao digitar, conta e mostra a prévia ao vivo', () => {
    setup();
    expect(slugInput()).toHaveFocus();
    fireEvent.change(slugInput(), { target: { value: 'Promoção Top' } });
    expect(slugInput()).toHaveValue('promocao-top');
    expect(screen.getByText('12/50')).toBeInTheDocument();
    expect(preview()).toHaveTextContent('https://promocao-top.copysync.com.br');
  });

  it('cria com o nome finalizado e limpa o rascunho', async () => {
    svc.create.mockResolvedValue(rotation);
    const h = setup({}, 'dark');
    fireEvent.change(slugInput(), { target: { value: 'promo-' } });
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    await waitFor(() => expect(h.onSaved).toHaveBeenCalledWith(rotation));
    expect(svc.create).toHaveBeenCalledWith({ sessionId: 's1', domainId: 'd1', slug: 'promo', strategy: 'BALANCED' });
    expect(sessionStorage.getItem('ui.linkRotation.config.new')).toBeNull();
  });

  it('nome curto não envia e explica no campo', () => {
    setup();
    fireEvent.change(slugInput(), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    expect(screen.getByText(t.slugTooShort(3))).toBeInTheDocument();
    expect(slugInput()).toHaveAttribute('aria-invalid', 'true');
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('409 LINK_SLUG_TAKEN mostra sugestões clicáveis que preenchem o nome', async () => {
    svc.create.mockRejectedValue({ code: 'LINK_SLUG_TAKEN', meta: { suggestions: ['promo-oficial', 'promo2'] } });
    setup();
    fireEvent.change(slugInput(), { target: { value: 'promo' } });
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    expect(await screen.findByText(linkRotationStrings.errors.slugTaken)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.suggestionUse('promo2') }));
    expect(slugInput()).toHaveValue('promo2');
    expect(preview()).toHaveTextContent('https://promo2.copysync.com.br');
    expect(screen.queryByText(t.suggestions)).not.toBeInTheDocument();
  });

  it('nome reservado: mensagem no campo', async () => {
    svc.create.mockRejectedValue({ code: 'LINK_SLUG_RESERVED' });
    setup();
    fireEvent.change(slugInput(), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    expect(await screen.findByText(linkRotationStrings.errors.slugReserved)).toBeInTheDocument();
  });

  it('limite do plano aciona o aviso da página', async () => {
    svc.create.mockRejectedValue({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotations', limit: 1 } });
    const h = setup();
    fireEvent.change(slugInput(), { target: { value: 'promo' } });
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    await waitFor(() => expect(h.onPlanLimit).toHaveBeenCalledWith('rotations', 1));
  });

  it('trocar o nome pede confirmação antes do rename', async () => {
    svc.rename.mockResolvedValue({ ...rotation, slug: 'promo-nova', publicUrl: 'https://promo-nova.copysync.com.br' });
    const h = setup({ rotation });
    fireEvent.change(slugInput(), { target: { value: 'promo-nova' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(await screen.findByText(t.renameConfirmTitle)).toBeInTheDocument();
    expect(svc.rename).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.renameConfirm }));
    await waitFor(() => expect(h.onSaved).toHaveBeenCalled());
    expect(svc.rename).toHaveBeenCalledWith('r1', { slug: 'promo-nova' });
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('edição sem trocar o nome só chama update com o que mudou', async () => {
    svc.update.mockResolvedValue({ ...rotation, strategy: 'RANDOM' });
    const h = setup({ rotation });
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(linkRotationStrings.strategy.label.RANDOM) }));
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(h.onSaved).toHaveBeenCalled());
    expect(svc.update).toHaveBeenCalledWith('r1', { strategy: 'RANDOM' });
    expect(svc.rename).not.toHaveBeenCalled();
  });

  it('trocar a sessão avisa que os grupos saem do link', async () => {
    setup({ rotation });
    expect(screen.queryByText(t.sessionChangeWarning(2))).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: new RegExp(t.session) }));
    fireEvent.click(await screen.findByRole('option', { name: /Reserva/ }));
    expect(screen.getByText(t.sessionChangeWarning(2))).toBeInTheDocument();
    expect(screen.getByText(t.sessionDisconnected)).toBeInTheDocument();
  });

  it('rascunho sobrevive a remontar e cancelar limpa', () => {
    const first = setup();
    fireEvent.change(slugInput(), { target: { value: 'rascunho' } });
    expect(sessionStorage.getItem('ui.linkRotation.config.new')).toContain('rascunho');
    fireEvent.click(screen.getByRole('button', { name: t.cancel }));
    expect(first.onClose).toHaveBeenCalled();
    expect(sessionStorage.getItem('ui.linkRotation.config.new')).toBeNull();
  });
});
