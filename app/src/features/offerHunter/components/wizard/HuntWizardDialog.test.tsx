import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hunt, huntOptions } from '../../test/fixtures';

const svc = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), get: vi.fn(), run: vi.fn() }));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));

import { HuntWizardDialog } from './HuntWizardDialog';
import { wizardDraftKey } from './wizardDraft';

const field = (label: RegExp) => screen.getByRole('textbox', { name: label });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
const stored = (key: string) => {
  const raw = sessionStorage.getItem(`ui.${key}`);
  return raw ? JSON.parse(raw).d : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  svc.list.mockResolvedValue([]);
});

describe('HuntWizardDialog', () => {
  it('predefinição preenche faixa de comissão e filtros', () => {
    render(<HuntWizardDialog open options={huntOptions()} onClose={vi.fn()} onSaved={vi.fn()} />);
    // 1ª predefinição já vem aplicada
    expect(screen.getByRole('radio', { name: /Maior comissão/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Mais vendidos/ }));
    expect(screen.getByRole('radio', { name: /Mais vendidos/ })).toHaveAttribute('aria-checked', 'true');
    const d = stored(wizardDraftKey());
    expect(d.commissionBand).toBe('ANY');
    expect(d.sort).toBe('BEST_SELLING');
    expect(d.filters).toMatchObject({ minSales: 100, minRating: 4, minCommissionPct: null });
  });

  it('validação bloqueia avançar sem nome', () => {
    render(<HuntWizardDialog open options={huntOptions()} onClose={vi.fn()} onSaved={vi.fn()} />);
    next();
    expect(screen.getByText('Dê um nome à caçada.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'O que caçar' })).toBeInTheDocument();
    fireEvent.change(field(/Palavra-chave/), { target: { value: 'palavra-longa-demais' } });
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'Moda' } });
    next();
    expect(screen.getByText('Use até 10 caracteres.')).toBeInTheDocument();
  });

  it('salvar chama create com o corpo certo e limpa o rascunho', async () => {
    const saved = hunt({ id: 'new' });
    svc.create.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<HuntWizardDialog open options={huntOptions()} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(field(/Nome da caçada/), { target: { value: '  Moda verão ' } });
    fireEvent.change(field(/Palavra-chave/), { target: { value: 'vestido' } });
    next();
    fireEvent.change(field(/Desconto mínimo/), { target: { value: '30' } });
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Enviar direto/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Moda verão', keyword: 'vestido', commissionBand: 'ABOVE_15', sort: 'RECOMMENDED', aiEnabled: true, topN: 3,
      repeatAfterDays: 7, deliveryMode: 'AUTO', intervalMinutes: 60, windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127,
      filters: expect.objectContaining({ minCommissionPct: 15, minDiscountPct: 30, minPriceCents: null, onlyWithExtra: null }),
    }));
    expect(stored(wizardDraftKey())).toBeUndefined();
  });

  it('edição chama update e mostra erro de campo da API no passo dele', async () => {
    svc.update.mockRejectedValueOnce({ code: 'OFFER_INVALID_INPUT', field: 'topN' });
    render(<HuntWizardDialog open options={huntOptions()} hunt={hunt()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(field(/Nome da caçada/)).toHaveValue('Moda');
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith('h1', expect.objectContaining({ name: 'Moda', topN: 2 })));
    // Volta ao passo Refino com o campo marcado
    expect(await screen.findByRole('heading', { name: 'Refino' })).toBeInTheDocument();
    expect(field(/Ofertas por busca/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('rascunho sobrevive a remontar (reload) e some ao cancelar', () => {
    const onClose = vi.fn();
    const { unmount } = render(<HuntWizardDialog open options={huntOptions()} hunt={hunt()} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'Moda inverno' } });
    next();
    unmount();
    expect(stored(wizardDraftKey('h1'))).toMatchObject({ name: 'Moda inverno', step: 1 });
    // Rascunho da edição não vaza para a nova caçada
    expect(stored(wizardDraftKey())).toBeUndefined();

    render(<HuntWizardDialog open options={huntOptions()} hunt={hunt()} onClose={onClose} onSaved={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Refino' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalled();
    expect(stored(wizardDraftKey('h1'))).toBeUndefined();
  });

  it('IA travada quando indisponível; testar agora só na edição', async () => {
    render(<HuntWizardDialog open options={huntOptions({ gates: { ...huntOptions().gates, aiAvailable: false } })} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'X' } });
    next();
    expect(screen.getByRole('checkbox', { name: /Escolha com IA/ })).toBeDisabled();
    next();
    expect(screen.queryByRole('button', { name: 'Testar agora' })).not.toBeInTheDocument();
  });

  it('testar agora roda a caçada salva e mostra o ranking', async () => {
    svc.get.mockResolvedValue(hunt());
    svc.run.mockResolvedValue({
      runId: 'r1', status: 'SUCCEEDED', errorCode: null, seenCount: 10, matchedCount: 4, chosenCount: 1, sentCount: 0,
      aiUsed: false, aiFallback: false, remainingToday: 9, pausedReason: null, finds: [],
      ranking: [{ goodsId: 'g1', title: 'Vestido', imageUrl: null, priceCents: 1990, score: 80, factors: [], aiReason: null, chosen: true }],
    });
    render(<HuntWizardDialog open options={huntOptions()} hunt={hunt()} onClose={vi.fn()} onSaved={vi.fn()} />);
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Testar agora' }));
    expect(await screen.findByText('Vestido')).toBeInTheDocument();
    expect(svc.run).toHaveBeenCalledWith('h1');
    expect(screen.getByText('10 ofertas vistas, 4 no filtro, 1 escolhida')).toBeInTheDocument();
  });
});
