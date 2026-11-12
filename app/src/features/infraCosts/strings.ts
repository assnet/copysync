/** Textos dos custos da infraestrutura (super admin). pt-BR, sem nome de marca. */
import type {
  InfraCostBilling,
  InfraCostCategory,
  InfraCostSettingsSource,
  InfraCostWarningCode,
  InfraFxClosingMethod,
  InfraFxSource,
  InfraQuantitySource,
} from './types';

export const infraCostsStrings = {
  navLabel: 'Custos',
  pageTitle: 'Custos da infraestrutura',
  pageSubtitle: 'Quanto custa a operação no mês, por serviço, por sessão e por plano. Valores estimados.',
  tabs: { summary: 'Resumo', prices: 'Preços', aria: 'Visões de custos' },
  retry: 'Tentar de novo',
  /** Valor ausente (sem amostra, sem cotação, divisão por zero). */
  noValue: '—',
  noSample: 'sem amostra',
  estimated: 'estimado',
  storageToConfirm: '+ armazenamento a confirmar',
  marginLabel: 'Margem bruta de infraestrutura (sem gateway, impostos e IA da chave do tenant)',
  marginMonthly: 'Mensal',
  marginAnnual: 'Anual (equivalente mensal)',
  marginHiddenNoFx: 'Sem cotação: a margem aparece depois de informar a cotação do dólar.',
  fxSourceAttribution: 'Fonte: Banco Central do Brasil (PTAX)',

  origin: {
    default: 'Valores iniciais (conferir no painel da Render)',
    saved: 'Valores salvos',
  } satisfies Record<InfraCostSettingsSource, string>,

  quantitySource: {
    manual: 'Manual',
    measured_now: 'Medido agora',
    measured_hours: 'Medido por hora',
  } satisfies Record<InfraQuantitySource, string>,

  fxSource: {
    override: 'Manual',
    ptax: 'PTAX',
    sgs: 'BCB (SGS)',
    last_known: 'Última conhecida',
  } satisfies Record<InfraFxSource, string>,

  closingMethod: {
    last_business_day: 'Último dia útil do mês',
    month_average: 'Média do mês',
  } satisfies Record<InfraFxClosingMethod, string>,

  category: {
    compute: 'Computação',
    database: 'Banco de dados',
    cache: 'Cache',
    static: 'Site estático',
    storage: 'Armazenamento',
    ai: 'IA',
    email: 'E-mail',
    platform: 'Plataforma',
    other: 'Outro',
  } satisfies Record<InfraCostCategory, string>,

  billing: {
    fixed: 'Fixo por mês',
    per_instance: 'Por instância',
    usage: 'Por uso (total do mês)',
  } satisfies Record<InfraCostBilling, string>,

  warnings: {
    config_drift: 'Cadastro diferente do lido no provedor',
    fx_fallback: 'Cotação do mês indisponível: usando a última salva',
    fx_missing: 'Sem cotação: valores só em dólar',
    ai_tokens_missing: 'Uso de IA sem contagem de tokens fora do total',
    plan_without_price: 'Plano lido sem preço cadastrado: total parcial',
    model_without_price: 'Modelo de IA sem preço cadastrado',
    missing_hours: 'Horas sem leitura: quantidade manual usada',
    storage_to_confirm: 'Armazenamento a confirmar: soma só a computação',
    unlimited_contracted: 'Tenants ilimitados contados pelo limite do plano',
  } satisfies Record<InfraCostWarningCode, string>,

  diff: { changed: 'Alterado', added: 'Incluído', removed: 'Removido', empty: 'Nenhuma alteração.' },

  errors: {
    required: 'Obrigatório',
    number: 'Informe um número',
    integer: 'Informe um número inteiro',
    range: (min: string, max: string) => `Entre ${min} e ${max}`,
    decimals: (n: number) => `No máximo ${n} casas decimais`,
    date: 'Data inválida (AAAA-MM-DD)',
    keyFormat: 'Use letras minúsculas, números, "-" ou "_" (até 40)',
    duplicate: 'Valor repetido',
    text: (max: number) => `De 1 a ${max} caracteres`,
    textMax: (max: number) => `Até ${max} caracteres`,
    option: 'Opção inválida',
    listMax: (max: number) => `No máximo ${max} linhas`,
    loadFailed: 'Não foi possível carregar os custos.',
    saveFailed: 'Não foi possível salvar os preços.',
    conflict: 'Outro admin salvou antes. Os preços foram recarregados e o rascunho descartado.',
  },
};
