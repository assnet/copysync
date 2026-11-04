import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import type { Rotation, RotationGroup, RotationGroupCandidate, RotationStrategy } from '../types';
import { linkRotationStrings as s } from '../strings';

const svc = vi.hoisted(() => ({ listGroups: vi.fn(), saveGroups: vi.fn(), refreshGroup: vi.fn() }));
vi.mock('@/services/linkRotation.service', () => ({ linkRotationService: svc }));

import { RotationGroupsDialog } from '../components/RotationGroupsDialog';

const t = s.groups;
const cand = (n: number, extra: Partial<RotationGroupCandidate> = {}): RotationGroupCandidate => ({
  groupJid: `g${n}@g.us`, title: `Grupo ${n}`, avatarUrl: null, conversationId: `c${n}`, selected: false, rotationGroupId: null, status: null, ...extra,
});
const saved = (n: number, extra: Partial<RotationGroup> = {}): RotationGroup => ({
  id: `rg${n}`, conversationId: `c${n}`, groupJid: `g${n}@g.us`, groupName: `Grupo ${n}`, position: n, weight: 1, capacity: 1000,
  inviteUrl: null, linkSource: 'AUTO', status: 'ACTIVE', memberCount: 10, memberCountAt: null, clicksSinceSync: 0, clickCount: 0, lastClickAt: null, ...extra,
});
const rotation = (groups: RotationGroup[] = [], strategy: RotationStrategy = 'BALANCED', channel: Rotation['channel'] = 'whatsapp'): Rotation => ({
  id: 'r1', sessionId: 's1', channel, domainId: 'd1', hostname: 'x.app', slug: 'promo', publicUrl: 'https://promo.x.app', status: 'ACTIVE',
  strategy, title: null, clickCount: 0, lastClickAt: null, allFullNotifiedAt: null, createdAt: '', updatedAt: '', groups,
});

function setup(rot: Rotation, limit: number | null, candidates: RotationGroupCandidate[]) {
  svc.listGroups.mockResolvedValue({ partial: false, groups: candidates });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  renderWithTheme(
    <MemoryRouter><PrivacyProvider><RotationGroupsDialog open rotation={rot} limit={limit} onSaved={onSaved} onClose={onClose} /></PrivacyProvider></MemoryRouter>,
  );
  return { onSaved, onClose };
}

const checkbox = async (n: number) => screen.findByRole('checkbox', { name: t.selectAria(`Grupo ${n}`) });

describe('RotationGroupsDialog', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.values(svc).forEach((f) => f.mockReset());
  });

  it('marcar além do limite abre o aviso e não seleciona', async () => {
    const groups = [saved(1), saved(2), saved(3)];
    setup(rotation(groups), 3, [1, 2, 3, 4].map((n) => cand(n, n < 4 ? { selected: true } : {})));
    const fourth = await checkbox(4);
    expect(screen.getByText(t.selectedCount(3, 4))).toBeInTheDocument();
    expect(screen.getByText(t.planLimit(3))).toBeInTheDocument();
    fireEvent.click(fourth);
    expect(await screen.findByText(s.upgrade.groupsTitle)).toBeInTheDocument();
    expect(screen.getByText(s.upgrade.nextPlan('PRO', 5, 'groups'))).toBeInTheDocument();
    expect(fourth).not.toBeChecked();
    expect(screen.queryByTestId('rotation-group-g4@g.us')).not.toBeInTheDocument();
  });

  it('menos que o limite salva e limpa o rascunho', async () => {
    const { onSaved } = setup(rotation(), 3, [cand(1), cand(2)]);
    fireEvent.click(await checkbox(2));
    svc.saveGroups.mockResolvedValue([saved(2)]);
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith([saved(2)]));
    expect(svc.saveGroups).toHaveBeenCalledWith('r1', [{ conversationId: 'c2', position: 0, weight: 1, capacity: 1000, manualInviteUrl: null }]);
    expect(sessionStorage.getItem('ui.linkRotation.groups.r1')).toBeNull();
  });

  it('ordem com setas define a posição enviada', async () => {
    setup(rotation(), null, [cand(1), cand(2)]);
    fireEvent.click(await checkbox(1));
    fireEvent.click(await checkbox(2));
    const second = screen.getByTestId('rotation-group-g2@g.us');
    fireEvent.click(within(second).getByRole('button', { name: t.moveUpAria('Grupo 2') }));
    svc.saveGroups.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(svc.saveGroups).toHaveBeenCalled());
    expect(svc.saveGroups.mock.calls[0]![1].map((g: { conversationId: string }) => g.conversationId)).toEqual(['c2', 'c1']);
  });

  it('peso só aparece na estratégia por peso', async () => {
    setup(rotation([saved(1)]), 3, [cand(1, { selected: true })]);
    await checkbox(1);
    expect(screen.queryByTestId('rotation-group-weight')).not.toBeInTheDocument();
  });

  it('peso aparece em WEIGHTED', async () => {
    setup(rotation([saved(1)], 'WEIGHTED'), 3, [cand(1, { selected: true })]);
    await checkbox(1);
    expect(screen.getByTestId('rotation-group-weight')).toBeInTheDocument();
  });

  it('link manual: exige o link e envia o colado', async () => {
    setup(rotation(), 3, [cand(1)]);
    fireEvent.click(await checkbox(1));
    fireEvent.click(screen.getByRole('button', { name: t.linkManual }));
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(await screen.findByText(t.manualInviteRequired)).toBeInTheDocument();
    expect(svc.saveGroups).not.toHaveBeenCalled();

    const field = screen.getByLabelText(t.manualInviteUrl);
    fireEvent.change(field, { target: { value: 'https://exemplo.com/x' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(await screen.findByText(s.errors.inviteUrlInvalid.whatsapp)).toBeInTheDocument();
    expect(svc.saveGroups).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' } });
    svc.saveGroups.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(svc.saveGroups).toHaveBeenCalled());
    expect(svc.saveGroups.mock.calls[0]![1][0].manualInviteUrl).toBe('https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv');
  });

  it('sem convite: oculto por padrão, "Mostrar ocultos" revela com motivo e entra como manual', async () => {
    setup(rotation(), 3, [cand(1, { canInvite: false, inviteBlockedReason: 'NOT_ADMIN' })]);
    expect(await screen.findByText(t.allHiddenUninvitable(1))).toBeInTheDocument();
    expect(screen.getByText(t.hiddenCount(1))).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: t.selectAria('Grupo 1') })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.showHidden }));
    const box = await checkbox(1);
    expect(screen.getByText(t.inviteBlocked.NOT_ADMIN)).toBeInTheDocument();
    fireEvent.click(box);
    expect(screen.getByRole('button', { name: t.linkManual })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(t.manualInviteUrl)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.linkAuto }));
    expect(screen.getByText(t.inviteBlockedAuto)).toBeInTheDocument();
  });

  it('sem convite já marcado continua visível com o filtro ligado', async () => {
    setup(rotation([saved(1)]), 3, [cand(1, { selected: true, canInvite: false }), cand(2)]);
    expect(await checkbox(1)).toBeChecked();
    expect(screen.queryByText(t.hiddenCount(1))).not.toBeInTheDocument();
  });

  it('indisponíveis vão para o fim da lista', async () => {
    sessionStorage.clear();
    setup(rotation(), 3, [cand(1, { canInvite: false }), cand(2)]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ocultar grupos/i }));
    await checkbox(1);
    const names = screen.getAllByRole('checkbox', { name: /^Usar / }).map((c) => c.getAttribute('aria-label'));
    expect(names).toEqual([t.selectAria('Grupo 2'), t.selectAria('Grupo 1')]);
  });

  it('NEEDS_LINK mostra o campo para colar o convite', async () => {
    setup(rotation([saved(1, { status: 'NEEDS_LINK' })]), 3, [cand(1, { selected: true, status: 'NEEDS_LINK' })]);
    await checkbox(1);
    expect(screen.getByLabelText(t.manualInviteUrl)).toBeInTheDocument();
  });

  it('403 PLAN_LIMIT_REACHED no salvar abre o aviso', async () => {
    setup(rotation(), 3, [cand(1)]);
    fireEvent.click(await checkbox(1));
    svc.saveGroups.mockRejectedValue({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotation_groups', limit: 3 } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(await screen.findByText(s.upgrade.groupsTitle)).toBeInTheDocument();
  });

  it('lista vazia explica que a sessão precisa estar nos grupos', async () => {
    setup(rotation(), 3, []);
    expect(await screen.findByText(t.empty.whatsapp)).toBeInTheDocument();
  });

  it('atualizar relê o grupo', async () => {
    setup(rotation([saved(1)]), 3, [cand(1, { selected: true })]);
    await checkbox(1);
    svc.refreshGroup.mockResolvedValue(saved(1, { status: 'FULL', memberCount: 1000 }));
    fireEvent.click(screen.getByRole('button', { name: t.refreshAria('Grupo 1') }));
    expect(await screen.findByText(s.groupStatus.FULL)).toBeInTheDocument();
    expect(svc.refreshGroup).toHaveBeenCalledWith('r1', 'rg1');
  });

  it('Telegram: teto padrão 10.000, link t.me, faixa até 200.000 e convite atual no formato do canal', async () => {
    setup(
      rotation([saved(1, { inviteUrl: 'https://t.me/+AbCdEf_12-GhIjKl', capacity: 150_000 })], 'BALANCED', 'telegram'),
      3,
      [cand(1, { selected: true }), cand(2)],
    );
    fireEvent.click(await checkbox(2));
    expect(within(screen.getByTestId('rotation-group-g1@g.us')).getByTestId('rotation-group-invite')).toHaveTextContent('https://t.me/+AbCdEf_12-GhIjKl');
    const item2 = within(screen.getByTestId('rotation-group-g2@g.us'));
    expect(item2.getByRole('slider')).toHaveAttribute('aria-valuemax', '200000');
    expect(item2.getByRole('slider')).toHaveAttribute('aria-valuenow', '10000');

    fireEvent.click(item2.getByRole('button', { name: t.linkManual }));
    const field = item2.getByLabelText(t.manualInviteUrl);
    expect(field).toHaveAttribute('placeholder', 'https://t.me/+…');
    fireEvent.change(field, { target: { value: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(await screen.findByText(s.errors.inviteUrlInvalid.telegram)).toBeInTheDocument();

    fireEvent.change(field, { target: { value: 't.me/canal_ofertas' } });
    fireEvent.change(item2.getByLabelText(t.capacityInput), { target: { value: '200000' } });
    svc.saveGroups.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(svc.saveGroups).toHaveBeenCalled());
    expect(svc.saveGroups.mock.calls[0]![1][1]).toMatchObject({ capacity: 200_000, manualInviteUrl: 't.me/canal_ofertas' });
  });

  it('erro do atualizar fica no aviso do item, sem marcar o campo de convite', async () => {
    setup(rotation([saved(1, { linkSource: 'MANUAL', inviteUrl: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' })]), 3, [cand(1, { selected: true })]);
    await checkbox(1);
    svc.refreshGroup.mockRejectedValue({ code: 'SESSION_NOT_CONNECTED' });
    fireEvent.click(screen.getByRole('button', { name: t.refreshAria('Grupo 1') }));
    expect(await screen.findByText(s.errors.sessionNotConnected)).toBeInTheDocument();
    const field = screen.getByLabelText(t.manualInviteUrl);
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t.manualInviteHelp.whatsapp)).toBeInTheDocument();
  });

  it('estimado no teto mostra "No limite" em vez de "Recebendo cliques"', async () => {
    setup(rotation([saved(1, { capacity: 50, memberCount: 49, clicksSinceSync: 1 })]), 3, [cand(1, { selected: true })]);
    await checkbox(1);
    expect(screen.getByText(t.atCapacity)).toBeInTheDocument();
    expect(screen.queryByText(s.groupStatus.ACTIVE)).not.toBeInTheDocument();
    expect(screen.getByText(t.membersEstimated(50, 50))).toBeInTheDocument();
  });

  it('abaixo do teto segue "Recebendo cliques"', async () => {
    setup(rotation([saved(1, { capacity: 50, memberCount: 48, clicksSinceSync: 1 })]), 3, [cand(1, { selected: true })]);
    await checkbox(1);
    expect(screen.getByText(s.groupStatus.ACTIVE)).toBeInTheDocument();
  });

  it('flag inviteLink borra o texto do link de convite', async () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['linkRotation.inviteLink']));
    try {
      setup(rotation([saved(1, { linkSource: 'MANUAL', inviteUrl: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' })]), 3, [cand(1, { selected: true })]);
      await checkbox(1);
      expect(screen.getByLabelText(t.manualInviteUrl)).toHaveStyle({ filter: 'blur(5px)' });
    } finally {
      localStorage.removeItem('privacy.blur');
    }
  });

  it('sem a flag o link de convite fica legível', async () => {
    setup(rotation([saved(1, { linkSource: 'MANUAL', inviteUrl: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' })]), 3, [cand(1, { selected: true })]);
    await checkbox(1);
    expect(screen.getByLabelText(t.manualInviteUrl)).not.toHaveStyle({ filter: 'blur(5px)' });
  });
});
