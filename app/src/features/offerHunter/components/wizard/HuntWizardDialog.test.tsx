import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { hunt, huntOptions, mlOptions, providerState } from '../../test/fixtures';
import type { HuntAiSuggestion } from '../../types';

const svc = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), get: vi.fn(), run: vi.fn(), getProviders: vi.fn(), getOptions: vi.fn(), suggestConfig: vi.fn(),
}));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));

import { HuntWizardDialog, type HuntWizardDialogProps } from './HuntWizardDialog';
import { wizardDraftKey } from './wizardDraft';

const field = (label: RegExp) => screen.getByRole('textbox', { name: label });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
const stored = (key: string) => {
  const raw = sessionStorage.getItem(`ui.${key}`);
  return raw ? JSON.parse(raw).d : undefined;
};
const renderWizard = (props: Partial<HuntWizardDialogProps> = {}) => render(
  <MemoryRouter initialEntries={['/offer-hunter']}>
    <Routes>
      <Route path="/offer-hunter" element={<HuntWizardDialog open options={huntOptions()} onClose={vi.fn()} onSaved={vi.fn()} {...props} />} />
      <Route path="/affiliates/credentials" element={<p>Tela de credenciais</p>} />
    </Routes>
  </MemoryRouter>,
);
/** Escolhe a loja no passo 0 e avança para "O que caçar". */
const pickStore = async (name: RegExp, advance = true) => {
  fireEvent.click(await screen.findByRole('radio', { name }));
  if (advance) {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());
    next();
  }
};
const suggestion = (over: Partial<HuntAiSuggestion> = {}): HuntAiSuggestion => ({
  draft: {
    provider: 'SHEIN', name: 'Vestidos de festa', categoryId: null, keyword: 'vestido', sort: 'TOP_RATED', sourceOptions: {},
    filters: { minDiscountPct: 30 }, aiEnabled: null, topN: null,
  },
  reasons: { 'filters.minDiscountPct': 'Desconto alto vende mais', name: 'Resume a intenção' },
  dropped: ['filters.minReviews'],
  sourceUsed: false,
  remainingToday: 4,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  svc.list.mockResolvedValue([]);
  svc.getProviders.mockResolvedValue([providerState('SHEIN'), providerState('MERCADO_LIVRE')]);
  svc.getOptions.mockImplementation((p: string) => Promise.resolve(p === 'MERCADO_LIVRE' ? mlOptions() : huntOptions()));
});

describe('HuntWizardDialog: passo 0 (loja)', () => {
  it('mostra as lojas com estado e ação; sem loja não avança', async () => {
    const onOpenRisk = vi.fn();
    svc.getProviders.mockResolvedValue([
      providerState('SHEIN', {}, { riskAccepted: false }),
      providerState('MERCADO_LIVRE', { credentialState: 'MISSING' }, { credential: false }),
    ]);
    renderWizard({ onOpenRisk });
    expect(await screen.findByRole('radio', { name: 'SHEIN: Aviso de risco pendente' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Mercado Livre: Conta não conectada' })).toBeInTheDocument();
    next();
    expect(screen.getByText('Escolha uma loja para continuar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ler aviso: SHEIN' }));
    expect(onOpenRisk).toHaveBeenCalledWith('SHEIN');
    fireEvent.click(screen.getByRole('button', { name: 'Conectar conta: Mercado Livre' }));
    expect(await screen.findByText('Tela de credenciais')).toBeInTheDocument();
  });

  it('loja fora do plano não é escolhível', async () => {
    svc.getProviders.mockResolvedValue([providerState('SHEIN'), providerState('MERCADO_LIVRE', {}, { plan: false })]);
    renderWizard();
    expect(await screen.findByRole('radio', { name: 'Mercado Livre: Fora do seu plano' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver planos: Mercado Livre' })).toBeInTheDocument();
  });

  it('edição: loja fixa (logo, sem grade) e opções da loja da caçada', async () => {
    renderWizard({ hunt: hunt({ provider: 'MERCADO_LIVRE', sourceOptions: { sort: 'lowest_price', extraEarningsOnly: null, bestSellersOnly: true } }) });
    expect(screen.getByRole('group', { name: 'Loja desta caçada' })).toHaveTextContent('Mercado Livre');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(svc.getProviders).not.toHaveBeenCalled();
    await waitFor(() => expect(svc.getOptions).toHaveBeenCalledWith('MERCADO_LIVRE'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());
    next();
    expect(screen.getByRole('combobox', { name: /Ordem da busca/ })).toHaveTextContent('Menor preço');
  });
});

describe('HuntWizardDialog: filtros por loja', () => {
  it('Mercado Livre: ordem e filtros da fonte, sem avaliações/prazo; corpo com sourceOptions', async () => {
    svc.create.mockResolvedValue(hunt({ id: 'new', provider: 'MERCADO_LIVRE' }));
    renderWizard();
    await pickStore(/^Mercado Livre/);
    expect(screen.getByRole('radio', { name: /Maior comissão/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/Ordem sugerida/)).not.toBeInTheDocument();
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'Tênis' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Ordem da busca/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Menor preço' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Só com ganhos extras/ }));
    next();
    expect(screen.queryByRole('textbox', { name: /Avaliações mínimas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Termina em até/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Só com comissão extra/ })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Percentual da comissão' })).toHaveValue('15');
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(svc.create).toHaveBeenCalled());
    const body = svc.create.mock.calls[0]![0];
    expect(body).toMatchObject({
      provider: 'MERCADO_LIVRE', name: 'Tênis', sort: 'RECOMMENDED',
      sourceOptions: { sort: 'lowest_price', extraEarningsOnly: true, bestSellersOnly: null },
      filters: { minCommissionPct: 15, commissionOperator: 'GTE', minReviews: null, endsWithinDays: null },
    });
  });

  it('SHEIN: sem filtros da fonte do ML; avaliações e prazo aparecem', async () => {
    renderWizard();
    await pickStore(/^SHEIN/);
    expect(screen.queryByRole('combobox', { name: /Ordem da busca/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Só com ganhos extras/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Ordem sugerida à SHEIN/)).toBeInTheDocument();
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'X' } });
    next();
    expect(screen.getByRole('textbox', { name: /Avaliações mínimas/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Só com comissão extra/ })).toBeInTheDocument();
    expect(svc.getOptions).not.toHaveBeenCalled();
  });
});

describe('HuntWizardDialog: IA decide os filtros', () => {
  it('gera o rascunho, marca os campos com o motivo e salva como configurado pela IA', async () => {
    svc.suggestConfig.mockResolvedValue(suggestion());
    svc.create.mockResolvedValue(hunt({ id: 'new' }));
    renderWizard();
    await pickStore(/^SHEIN/, false);
    const toggle = await screen.findByRole('checkbox', { name: /Deixar a IA decidir os filtros/ });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/O "Escolha com IA", no Refino, é outra coisa/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Gerar com IA' })).toBeDisabled();
    fireEvent.change(field(/O que você quer caçar/), { target: { value: 'vestido de festa' } });
    expect(screen.getByText('16/120')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar com IA' }));
    await waitFor(() => expect(svc.suggestConfig).toHaveBeenCalledWith({ provider: 'SHEIN', intent: 'vestido de festa', pickProduct: false }));
    expect(await screen.findByText('4 de 5 sugestões restantes hoje')).toBeInTheDocument();
    expect(screen.getByTestId('ai-dropped')).toHaveTextContent('Avaliações mínimas');
    next();
    expect(field(/Nome da caçada/)).toHaveValue('Vestidos de festa');
    expect(screen.getByTestId('ai-hint-name')).toBeInTheDocument();
    expect(screen.getByTestId('ai-hint-sort')).toBeInTheDocument();
    expect(screen.getByText(/Mais bem avaliados/)).toBeInTheDocument();
    next();
    fireEvent.mouseOver(screen.getByTestId('ai-hint-filters.minDiscountPct'));
    expect(await screen.findByText('Desconto alto vende mais')).toBeInTheDocument();
    expect(field(/Desconto mínimo/)).toHaveValue('30');
    // Predefinição trocada pelos filtros da IA
    expect(screen.getByRole('combobox', { name: /Condição da comissão/ })).toHaveTextContent('Qualquer comissão');
    fireEvent.change(field(/Desconto mínimo/), { target: { value: '40' } });
    expect(screen.queryByTestId('ai-hint-filters.minDiscountPct')).not.toBeInTheDocument();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(svc.create).toHaveBeenCalled());
    expect(svc.create.mock.calls[0]![0]).toMatchObject({
      provider: 'SHEIN', sort: 'TOP_RATED', sourceOptions: null, aiConfigured: true, aiIntent: 'vestido de festa',
      filters: expect.objectContaining({ minDiscountPct: 40, minCommissionPct: null }),
    });
  });

  it('429: limite do dia avisa e trava gerar', async () => {
    svc.suggestConfig.mockRejectedValue({ status: 429, code: 'OFFER_HUNT_AI_SUGGEST_DAILY_LIMIT' });
    renderWizard();
    await pickStore(/^SHEIN/, false);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Deixar a IA decidir os filtros/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Deixar a IA escolher o produto/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar com IA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Você já usou as 5 sugestões de IA de hoje');
    expect(svc.suggestConfig).toHaveBeenCalledWith({ provider: 'SHEIN', intent: null, pickProduct: true });
    expect(screen.getByText('0 de 5 sugestões restantes hoje')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar com IA' })).toBeDisabled();
  });

  it('AI_NOT_CONFIGURED desliga o interruptor; sem IA na conta ele já nasce travado', async () => {
    svc.suggestConfig.mockRejectedValue({ status: 409, code: 'AI_NOT_CONFIGURED' });
    const { unmount } = renderWizard();
    await pickStore(/^SHEIN/, false);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Deixar a IA decidir os filtros/ }));
    fireEvent.change(field(/O que você quer caçar/), { target: { value: 'tênis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar com IA' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Deixar a IA decidir os filtros/ })).toBeDisabled());
    expect(screen.getByText(/Nenhum provedor de IA disponível/)).toBeInTheDocument();
    unmount();
    sessionStorage.clear();
    renderWizard({ options: huntOptions({ gates: { ...huntOptions().gates, aiAvailable: false } }) });
    await pickStore(/^SHEIN/, false);
    expect(await screen.findByRole('checkbox', { name: /Deixar a IA decidir os filtros/ })).toBeDisabled();
  });
});

describe('HuntWizardDialog: assistente', () => {
  it('rascunho antigo (v2) é descartado', async () => {
    sessionStorage.setItem(`ui.${wizardDraftKey()}`, JSON.stringify({ v: 2, d: { step: 2, name: 'Velho' } }));
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Onde caçar' })).toBeInTheDocument();
    await pickStore(/^SHEIN/);
    expect(field(/Nome da caçada/)).toHaveValue('');
  });

  it('predefinição preenche filtros (comissão de 1ª compra inclusa)', async () => {
    renderWizard();
    await pickStore(/^SHEIN/);
    expect(screen.getByRole('radio', { name: /Maior comissão/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Mais vendidos/ }));
    const d = stored(wizardDraftKey());
    expect(d.provider).toBe('SHEIN');
    expect(d.sort).toBe('BEST_SELLING');
    expect(d.filters).toMatchObject({ minSales: 100, minRating: 4, minCommissionPct: null, commissionOperator: null });
  });

  it('validação bloqueia avançar sem nome', async () => {
    renderWizard();
    await pickStore(/^SHEIN/);
    next();
    expect(screen.getByText('Dê um nome à caçada.')).toBeInTheDocument();
    fireEvent.change(field(/Palavra-chave/), { target: { value: 'palavra-longa-demais' } });
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'Moda' } });
    next();
    expect(screen.getByText('Use até 10 caracteres.')).toBeInTheDocument();
  });

  it('salvar chama create com o corpo certo e limpa o rascunho', async () => {
    const saved = hunt({ id: 'new' });
    svc.create.mockResolvedValue(saved);
    const onSaved = vi.fn();
    renderWizard({ onSaved });
    await pickStore(/^SHEIN/);
    fireEvent.change(field(/Nome da caçada/), { target: { value: '  Moda verão ' } });
    fireEvent.change(field(/Palavra-chave/), { target: { value: 'vestido' } });
    next();
    fireEvent.change(field(/Desconto mínimo/), { target: { value: '30' } });
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Enviar direto/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'SHEIN', name: 'Moda verão', keyword: 'vestido', sort: 'RECOMMENDED', sourceOptions: null, aiEnabled: true,
      aiConfigured: false, aiIntent: null, topN: 3, repeatAfterDays: 7, deliveryMode: 'AUTO', intervalMinutes: 60,
      windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127,
      filters: expect.objectContaining({ minCommissionPct: 15, commissionOperator: 'GTE', minDiscountPct: 30, minPriceCents: null, onlyWithExtra: null }),
    }));
    expect(svc.create.mock.calls[0]![0]).not.toHaveProperty('commissionBand');
    expect(stored(wizardDraftKey())).toBeUndefined();
  });

  it('edição chama update e mostra erro de campo da API no passo dele', async () => {
    svc.update.mockRejectedValueOnce({ code: 'OFFER_INVALID_INPUT', field: 'topN' });
    renderWizard({ hunt: hunt() });
    next();
    expect(field(/Nome da caçada/)).toHaveValue('Moda');
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith('h1', expect.objectContaining({ provider: 'SHEIN', name: 'Moda', topN: 2 })));
    expect(await screen.findByRole('heading', { name: 'Refino' })).toBeInTheDocument();
    expect(field(/Ofertas por busca/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('rascunho sobrevive a remontar (reload) e some ao cancelar', () => {
    const onClose = vi.fn();
    const { unmount } = renderWizard({ hunt: hunt(), onClose });
    next();
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'Moda inverno' } });
    next();
    unmount();
    expect(stored(wizardDraftKey('h1'))).toMatchObject({ name: 'Moda inverno', step: 2 });
    expect(stored(wizardDraftKey())).toBeUndefined();

    renderWizard({ hunt: hunt(), onClose });
    expect(screen.getByRole('heading', { name: 'Refino' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalled();
    expect(stored(wizardDraftKey('h1'))).toBeUndefined();
  });

  it('IA travada quando indisponível; testar agora só na edição', async () => {
    renderWizard({ options: huntOptions({ gates: { ...huntOptions().gates, aiAvailable: false } }) });
    await pickStore(/^SHEIN/);
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
      ranking: [{ provider: 'SHEIN', productId: 'g1', goodsId: 'g1', title: 'Vestido', imageUrl: null, priceCents: 1990, score: 80, factors: [], aiReason: null, chosen: true }],
    });
    renderWizard({ hunt: hunt() });
    next();
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Testar agora' }));
    expect(await screen.findByText('Vestido')).toBeInTheDocument();
    expect(svc.run).toHaveBeenCalledWith('h1');
    expect(screen.getByText('10 ofertas vistas, 4 no filtro, 1 escolhida')).toBeInTheDocument();
  });

  it('comissão de 1ª compra: condição + atalho gravam o corpo; "qualquer comissão" limpa', async () => {
    svc.create.mockResolvedValue(hunt({ id: 'new' }));
    renderWizard();
    await pickStore(/^SHEIN/);
    fireEvent.change(field(/Nome da caçada/), { target: { value: 'Comissão' } });
    next();
    expect(screen.getByRole('slider', { name: /Percentual da comissão de 1ª compra/ })).toHaveValue('15');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Condição da comissão de 1ª compra/ }));
    fireEvent.click(screen.getByRole('option', { name: /Maior que \(>\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Usar 20%' }));
    expect(screen.getByRole('slider', { name: /Percentual/ })).toHaveValue('20');
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(svc.create).toHaveBeenCalled());
    expect(svc.create.mock.calls[0]![0].filters).toMatchObject({ minCommissionPct: 20, commissionOperator: 'GT' });
  });

  it('edição carrega condição e percentual; "qualquer comissão" desliga a barra e manda null', async () => {
    svc.update.mockResolvedValue(hunt());
    const h = hunt({ filters: { ...hunt().filters, minCommissionPct: 5, commissionOperator: 'LT' } });
    renderWizard({ hunt: h });
    next();
    next();
    expect(screen.getByRole('combobox', { name: /Condição da comissão/ })).toHaveTextContent('Menor que (<)');
    expect(screen.getByRole('slider', { name: /Percentual/ })).toHaveValue('5');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Condição da comissão/ }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Qualquer comissão' }));
    expect(screen.getByRole('slider', { name: /Percentual/ })).toBeDisabled();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caçada' }));
    await waitFor(() => expect(svc.update).toHaveBeenCalled());
    expect(svc.update.mock.calls[0]![1].filters).toMatchObject({ minCommissionPct: null, commissionOperator: null });
  });
});
