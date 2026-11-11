import { describe, expect, it } from 'vitest';
// Fonte do contrato da API como texto (Vite `?raw`), só para o teste de paridade da lista de incertas.
import apiScaleEventContract from '../../../../api/src/modules/sessions/domain/contracts/IWorkerScaleEventRepository.ts?raw';
import {
  WORKER_SETTINGS_LIMITS, diffSettings, draftToSettings, occupancyLevel, occupancyPercent, sortWorkers,
  formatDraftValue, isDraftFieldChanged, parseDraftNumber, validateSettingsDraft, clientsThatFit, needsStrongCapConfirm,
  sortPlansByCatalog, cooldownActive, formatScaleRemaining, scaleBlock, scaleReasonError, scaleRequestErrorMessage, scaleTargetError,
  scaleEventErrorMessage, scaleStepAllowed, defaultScaleTarget, isUncertainScaleError, UNCERTAIN_SCALE_EVENT_ERRORS,
} from './rules';
import { workersAdminStrings } from './strings';
import type { WorkerCapacityPlan, WorkerScalingSettings } from './types';

describe('occupancyPercent', () => {
  it('arredonda e limita a 0–100', () => {
    expect(occupancyPercent(1, 3)).toBe(33);
    expect(occupancyPercent(50, 40)).toBe(100);
    expect(occupancyPercent(0, 40)).toBe(0);
  });
  it('teto 0: cheio com sessão, vazio sem', () => {
    expect(occupancyPercent(2, 0)).toBe(100);
    expect(occupancyPercent(0, 0)).toBe(0);
  });
});

describe('occupancyLevel', () => {
  it('faixas ok / atenção / cheio', () => {
    expect(occupancyLevel(31, 40)).toBe('ok');
    expect(occupancyLevel(32, 40)).toBe('warning');
    expect(occupancyLevel(40, 40)).toBe('full');
  });
});

describe('sortWorkers', () => {
  it('mais ocupado primeiro, empate pelo id', () => {
    const list = [
      { workerId: 'b', sessions: 1, maxSessions: 10 },
      { workerId: 'c', sessions: 9, maxSessions: 10 },
      { workerId: 'a', sessions: 1, maxSessions: 10 },
    ];
    expect(sortWorkers(list).map((w) => w.workerId)).toEqual(['c', 'a', 'b']);
  });
});

describe('validateSettingsDraft', () => {
  const valid: WorkerScalingSettings = {
    maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 10, alertOccupancyRatio: 0.8,
    awaitingAlertSeconds: 120, scalerMode: 'off', minReplicas: 1, maxReplicas: 3,
    scaleUpSustainSeconds: 600, scaleCooldownSeconds: 900,
  };
  const e = workersAdminStrings.settings.errors;

  it('rascunho válido não tem erro (aceita texto com vírgula)', () => {
    expect(validateSettingsDraft(valid)).toEqual({});
    expect(validateSettingsDraft({ ...valid, alertOccupancyRatio: '0,75', maxSessionsPerWorker: '50' })).toEqual({});
  });

  const cases: [keyof typeof WORKER_SETTINGS_LIMITS, number, number][] = [
    ['maxSessionsPerWorker', 1, 1000],
    ['maxPendingLoginsPerWorker', 1, 500],
    ['alertOccupancyRatio', 0.5, 0.95],
    ['awaitingAlertSeconds', 30, 3600],
    ['minReplicas', 1, 1],
    ['maxReplicas', 3, 20],
    ['scaleUpSustainSeconds', 300, 3600],
    ['scaleCooldownSeconds', 300, 86400],
  ];
  it.each(cases)('%s aceita limites e recusa fora da faixa', (field, min, max) => {
    expect(validateSettingsDraft({ ...valid, [field]: min })[field]).toBeUndefined();
    expect(validateSettingsDraft({ ...valid, [field]: max })[field]).toBeUndefined();
    const lim = WORKER_SETTINGS_LIMITS[field];
    const step = lim.integer ? 1 : 0.01;
    expect(validateSettingsDraft({ ...valid, [field]: lim.min - step })[field]).toMatch(/^Use um valor entre/);
    expect(validateSettingsDraft({ ...valid, [field]: lim.max + step })[field]).toMatch(/^Use um valor entre/);
  });

  it('vazio, não numérico e decimal em campo inteiro', () => {
    expect(validateSettingsDraft({ ...valid, awaitingAlertSeconds: ' ' }).awaitingAlertSeconds).toBe(e.required);
    expect(validateSettingsDraft({ ...valid, maxSessionsPerWorker: 'abc' }).maxSessionsPerWorker).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, alertOccupancyRatio: 'x' }).alertOccupancyRatio).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, minReplicas: 1.5 }).minReplicas).toBe(e.integer);
    expect(validateSettingsDraft({ ...valid, maxReplicas: Number.NaN }).maxReplicas).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, minReplicas: '1,5' }).minReplicas).toBe(e.integer);
  });

  it('parseDraftNumber: só dígitos com um separador; milhar em campo inteiro', () => {
    expect(parseDraftNumber(' 1.000 ', true)).toBe(1000);
    expect(parseDraftNumber('1,000', true)).toBe(1000);
    expect(parseDraftNumber('1.000')).toBe(1);
    expect(parseDraftNumber('1.5', true)).toBe(1.5);
    expect(parseDraftNumber('0,8')).toBe(0.8);
    expect(parseDraftNumber('0.8')).toBe(0.8);
    for (const bad of ['0x10', '1e3', '-1', '+5', '1.000.000', '1,2,3', '.5', '5.', 'Infinity', '1 000', '']) {
      expect(parseDraftNumber(bad, true)).toBeNull();
    }
  });

  it('texto fora do formato vira "Use um número"; "1.000" no teto vale 1000', () => {
    expect(validateSettingsDraft({ ...valid, maxSessionsPerWorker: '0x10' }).maxSessionsPerWorker).toBe(e.number);
    expect(validateSettingsDraft({ ...valid, alertOccupancyRatio: '0,8' })).toEqual({});
    expect(validateSettingsDraft({ ...valid, maxSessionsPerWorker: '1.000' })).toEqual({});
    expect(draftToSettings({ ...valid, maxSessionsPerWorker: '1.000', scaleCooldownSeconds: '86.400' }))
      .toEqual({ ...valid, maxSessionsPerWorker: 1000, scaleCooldownSeconds: 86400 });
  });

  it('máximo de réplicas abaixo do mínimo', () => {
    expect(validateSettingsDraft({ ...valid, minReplicas: 5, maxReplicas: 4 }).maxReplicas).toBe(e.maxBelowMin);
    expect(validateSettingsDraft({ ...valid, minReplicas: 4, maxReplicas: 4 })).toEqual({});
  });

  it('modo de escala desconhecido', () => {
    const draft = { ...valid, scalerMode: 'turbo' as unknown as WorkerScalingSettings['scalerMode'] };
    expect(validateSettingsDraft(draft).scalerMode).toBe(e.scalerMode);
  });

  it('draftToSettings converte texto em número', () => {
    expect(draftToSettings({ ...valid, alertOccupancyRatio: '0,9', minReplicas: '2' }))
      .toEqual({ ...valid, alertOccupancyRatio: 0.9, minReplicas: 2 });
  });

  it('cada campo numérico tem rótulo, ajuda e faixa', () => {
    for (const field of Object.keys(WORKER_SETTINGS_LIMITS)) {
      const t = workersAdminStrings.settings.fields[field as keyof typeof WORKER_SETTINGS_LIMITS];
      expect(t.label && t.help && t.range).toBeTruthy();
    }
  });
});

describe('formatDraftValue / isDraftFieldChanged', () => {
  const saved = {
    maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 10, alertOccupancyRatio: 0.8, awaitingAlertSeconds: 120,
    scalerMode: 'off', minReplicas: 1, maxReplicas: 3, scaleUpSustainSeconds: 600, scaleCooldownSeconds: 86400,
  } as const;

  it('número com vírgula decimal e sem milhar; texto digitado fica como está', () => {
    expect(formatDraftValue(0.8)).toBe('0,8');
    expect(formatDraftValue(0.95)).toBe('0,95');
    expect(formatDraftValue(86400)).toBe('86400');
    expect(formatDraftValue('0.8')).toBe('0.8');
    expect(parseDraftNumber(formatDraftValue(0.85))).toBe(0.85);
  });

  it('compara o valor do rascunho com o gravado', () => {
    expect(isDraftFieldChanged('alertOccupancyRatio', { ...saved, alertOccupancyRatio: '0,8' }, saved)).toBe(false);
    expect(isDraftFieldChanged('alertOccupancyRatio', { ...saved, alertOccupancyRatio: '0.85' }, saved)).toBe(true);
    expect(isDraftFieldChanged('awaitingAlertSeconds', { ...saved, awaitingAlertSeconds: '' }, saved)).toBe(true);
    expect(isDraftFieldChanged('scaleCooldownSeconds', { ...saved, scaleCooldownSeconds: '86.400' }, saved)).toBe(false);
    expect(isDraftFieldChanged('scalerMode', { ...saved, scalerMode: 'manual' }, saved)).toBe(true);
    expect(isDraftFieldChanged('scalerMode', saved, saved)).toBe(false);
  });
});

describe('diffSettings', () => {
  const base: WorkerScalingSettings = {
    maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 10, alertOccupancyRatio: 0.8,
    awaitingAlertSeconds: 120, scalerMode: 'off', minReplicas: 1, maxReplicas: 3,
    scaleUpSustainSeconds: 600, scaleCooldownSeconds: 900,
  };
  it('sem mudança → lista vazia', () => {
    expect(diffSettings(base, { ...base })).toEqual([]);
  });
  it('lista só o que mudou, na ordem dos campos', () => {
    expect(diffSettings(base, { ...base, maxReplicas: 5, scalerMode: 'manual', maxSessionsPerWorker: 60 })).toEqual([
      { field: 'maxSessionsPerWorker', from: 40, to: 60 },
      { field: 'scalerMode', from: 'off', to: 'manual' },
      { field: 'maxReplicas', from: 3, to: 5 },
    ]);
  });
});

const ch = (contracted: number, unlimitedTenants = 0) => ({ contracted, unlimitedTenants, created: 0, connected: 0 });
const plan = (tenants: number, wa: number, tg: number, unlimited = 0): WorkerCapacityPlan =>
  ({ planSlug: 'P', tenants, whatsapp: ch(wa, unlimited), telegram: ch(tg) });

describe('clientsThatFit', () => {
  it('folga ÷ sessões contratadas pelo tenant médio (WhatsApp + Telegram), para baixo', () => {
    // 10 tenants, 30 + 10 contratadas → 4 por tenant; folga 50 → 12
    expect(clientsThatFit(plan(10, 30, 10), 50)).toBe(12);
    expect(clientsThatFit(plan(10, 30, 10), 3)).toBe(0);
  });
  it('sem tenant, ilimitado, sem contratada ou sem folga medida → null', () => {
    expect(clientsThatFit(plan(0, 0, 0), 50)).toBeNull();
    expect(clientsThatFit(plan(3, 6, 0, 1), 50)).toBeNull();
    expect(clientsThatFit(plan(3, 0, 0), 50)).toBeNull();
    expect(clientsThatFit(plan(3, 6, 0), null)).toBeNull();
  });
});

describe('needsStrongCapConfirm', () => {
  it('só acima do sugerido ou sem sugestão', () => {
    expect(needsStrongCapConfirm(60, null)).toBe(true);
    expect(needsStrongCapConfirm(60, 50)).toBe(true);
    expect(needsStrongCapConfirm(50, 50)).toBe(false);
    expect(needsStrongCapConfirm(20, 50)).toBe(false);
  });
});

describe('sortPlansByCatalog', () => {
  it('ordem do catálogo; desconhecido e sem plano no fim', () => {
    const rows = [null, 'COPYSYNC_MAX', 'OUTRO', 'COPYSYNC_LITE', 'ZETA', 'pro'].map((planSlug) => ({ planSlug }));
    expect(sortPlansByCatalog(rows).map((r) => r.planSlug)).toEqual(['COPYSYNC_LITE', 'pro', 'COPYSYNC_MAX', 'OUTRO', 'ZETA', null]);
  });
});

describe('escala (WSCALE-14)', () => {
  const base = {
    scaler: { status: 'ready' as const, desiredReplicas: 2, runningReplicas: 2, hasDisk: false, autoscalingEnabled: false },
    settings: { scalerMode: 'manual' as const, minReplicas: 1, maxReplicas: 4, scaleCooldownSeconds: 600 },
    cooldownUntil: null, lastEvent: null, enforced: true,
  };

  it('formatScaleRemaining em min/h, arredondando para cima', () => {
    expect(formatScaleRemaining(30)).toBe('menos de 1 min');
    expect(formatScaleRemaining(61)).toBe('2 min');
    expect(formatScaleRemaining(3600)).toBe('1 h');
    expect(formatScaleRemaining(5400)).toBe('1 h 30 min');
  });

  it('scaleBlock: modo, adoção, escalador e serviço', () => {
    expect(scaleBlock(base)).toBeNull();
    expect(scaleBlock({ ...base, settings: { ...base.settings, scalerMode: 'off' } })).toBe('modeOff');
    expect(scaleBlock({ ...base, enforced: false })).toBe('notEnforced');
    expect(scaleBlock({ ...base, scaler: { status: 'unavailable', reason: 'timeout' } })).toBe('notReady');
    expect(scaleBlock({ ...base, scaler: { ...base.scaler, hasDisk: true } })).toBe('disk');
    expect(scaleBlock({ ...base, scaler: { ...base.scaler, autoscalingEnabled: true } })).toBe('nativeAutoscaling');
  });

  it('cooldownActive pelo relógio dado', () => {
    expect(cooldownActive(null, 0)).toBe(false);
    expect(cooldownActive('2026-11-11T10:00:00.000Z', Date.parse('2026-11-11T09:59:00.000Z'))).toBe(true);
    expect(cooldownActive('2026-11-11T10:00:00.000Z', Date.parse('2026-11-11T10:00:00.000Z'))).toBe(false);
  });

  it('valida alvo e motivo', () => {
    expect(scaleTargetError('3', 2, 1, 4)).toBeNull();
    expect(scaleTargetError('2', 2, 1, 4)).not.toBeNull();
    expect(scaleTargetError('1.5', 2, 1, 4)).not.toBeNull();
    expect(scaleTargetError('', 2, 1, 4)).not.toBeNull();
    expect(scaleReasonError('  ab ')).not.toBeNull();
    expect(scaleReasonError('abc')).toBeNull();
    expect(scaleReasonError('x'.repeat(201))).not.toBeNull();
  });

  it('erro sem código conhecido: 400 = inválido, resto = genérico', () => {
    expect(scaleRequestErrorMessage({ status: 400, code: 'VALIDATION_ERROR' })).toMatch(/recusado/);
    expect(scaleRequestErrorMessage(new Error('rede'))).toMatch(/mesmo pedido não é duplicado/);
    expect(scaleRequestErrorMessage({ code: 'SCALE_DOWN_WOULD_EXCEED_CAPACITY', meta: {} })).toMatch(/menos vagas/);
    expect(scaleRequestErrorMessage({ code: 'SCALER_UNAVAILABLE', meta: { reason: 'rejected_by_provider' } })).toMatch(/recusou o pedido\. Nada foi alterado/);
  });

  it('429: retryAfterSeconds, depois Retry-After (segundos ou data HTTP), depois retryAt', () => {
    const re = workersAdminStrings.scale.requestErrors;
    const now = Date.parse('2026-11-11T12:00:00.000Z');
    expect(scaleRequestErrorMessage({ status: 429, code: 'SCALER_RATE_LIMITED', meta: { retryAfterSeconds: 12 }, retryAfter: '99' }, now)).toBe(re.rateLimited(12));
    expect(scaleRequestErrorMessage({ status: 429, code: 'X', retryAfter: '30' }, now)).toBe(re.rateLimited(30));
    expect(scaleRequestErrorMessage({ status: 429, retryAfter: 'Wed, 11 Nov 2026 12:01:30 GMT' }, now)).toBe(re.rateLimited(90));
    expect(scaleRequestErrorMessage({ status: 429, retryAfter: 'lixo' }, now)).toBe(re.rateLimited(null));
    expect(scaleRequestErrorMessage({ status: 429, meta: { retryAt: 'x' } }, now)).toBe(re.rateLimited(null));
    expect(scaleRequestErrorMessage({ status: 409, code: 'REQUEST_ID_REUSED' })).toBe(re.requestIdReused);
  });
});

describe('scaleEventErrorMessage', () => {
  const re = workersAdminStrings.scale.requestErrors;
  it('traduz CODIGO e CODIGO:motivo; desconhecido ou vazio = falha genérica', () => {
    expect(scaleEventErrorMessage('SCALER_UNAVAILABLE:auth')).toBe(re.unavailable);
    expect(scaleEventErrorMessage('SCALER_UNAVAILABLE:not_found')).toBe(re.unavailable);
    expect(scaleEventErrorMessage('SCALER_UNAVAILABLE')).toBe(re.unavailable);
    expect(scaleEventErrorMessage('SCALER_UNAVAILABLE:rejected_by_provider')).toBe(re.rejectedByProvider);
    expect(scaleEventErrorMessage('SCALER_UNAVAILABLE:read_rejected_by_provider')).toBe(re.rejectedByProvider);
    expect(scaleEventErrorMessage('SCALER_SERVICE_NOT_SCALABLE:disk')).toBe(re.notScalable.disk);
    expect(scaleEventErrorMessage('SCALER_RATE_LIMITED')).toBe(re.rateLimited(null));
    expect(scaleEventErrorMessage('OUTRO')).toBe(re.failedGeneric);
    expect(scaleEventErrorMessage(null)).toBe(re.failedGeneric);
  });

  it('resultado incerto (timeout, 5xx, falha inesperada) não diz que nada foi alterado', () => {
    for (const e of ['SCALER_UNAVAILABLE:timeout', 'SCALER_UNAVAILABLE:upstream', 'SCALE_REQUEST_FAILED']) {
      expect(scaleEventErrorMessage(e)).toBe(re.uncertain);
    }
    expect(re.uncertain).not.toMatch(/Nada foi alterado/);
  });

  it('falha na leitura antes do pedido (read_*) diz que nada foi alterado', () => {
    for (const e of ['SCALER_UNAVAILABLE:read_timeout', 'SCALER_UNAVAILABLE:read_upstream', 'SCALER_UNAVAILABLE:read_auth']) {
      expect(scaleEventErrorMessage(e)).toBe(re.unavailable);
    }
    expect(re.unavailable).toMatch(/Nada foi alterado/);
    expect(scaleRequestErrorMessage({ status: 503, code: 'SCALER_UNAVAILABLE', meta: { reason: 'timeout', phase: 'read' } })).toBe(re.unavailable);
  });
});

describe('UNCERTAIN_SCALE_EVENT_ERRORS', () => {
  it('paridade com UNCERTAIN_SCALE_FAILURE_ERRORS do contrato da API', () => {
    const block = /export const UNCERTAIN_SCALE_FAILURE_ERRORS = \[([^\]]*)\]/.exec(apiScaleEventContract)?.[1];
    expect(block).toBeDefined();
    const api = [...block!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(api.length).toBeGreaterThan(0);
    expect([...UNCERTAIN_SCALE_EVENT_ERRORS].sort()).toEqual(api.sort());
  });
});

describe('isUncertainScaleError', () => {
  const re = workersAdminStrings.scale.requestErrors;
  it('SCALE_REQUEST_FAILED ou SCALER_UNAVAILABLE com meta.uncertain; recusa antes da chamada não', () => {
    expect(isUncertainScaleError({ code: 'SCALE_REQUEST_FAILED' })).toBe(true);
    expect(isUncertainScaleError({ code: 'SCALER_UNAVAILABLE', meta: { reason: 'timeout', uncertain: true } })).toBe(true);
    expect(isUncertainScaleError({ code: 'SCALER_UNAVAILABLE', meta: { reason: 'timeout' } })).toBe(false);
    expect(isUncertainScaleError({ code: 'SCALER_RATE_LIMITED' })).toBe(false);
    expect(isUncertainScaleError(null)).toBe(false);
    expect(scaleRequestErrorMessage({ status: 503, code: 'SCALE_REQUEST_FAILED', meta: { uncertain: true } })).toBe(re.uncertain);
    expect(scaleRequestErrorMessage({ status: 503, code: 'SCALER_UNAVAILABLE', meta: { reason: 'upstream', uncertain: true } })).toBe(re.uncertain);
    expect(scaleRequestErrorMessage({ status: 503, code: 'SCALER_UNAVAILABLE', meta: { reason: 'auth' } })).toBe(re.unavailable);
  });
});

describe('scaleStepAllowed / defaultScaleTarget', () => {
  it('±1 só dentro da faixa', () => {
    expect(scaleStepAllowed(2, 1, 1, 4)).toBe(true);
    expect(scaleStepAllowed(4, 1, 1, 4)).toBe(false);
    expect(scaleStepAllowed(0, 1, 2, 4)).toBe(false);
    expect(scaleStepAllowed(1, 1, 2, 4)).toBe(true);
    expect(scaleStepAllowed(6, -1, 1, 4)).toBe(false);
    expect(scaleStepAllowed(1, -1, 1, 4)).toBe(false);
  });
  it('alvo inicial: vizinho na faixa ou a ponta mais perto', () => {
    expect(defaultScaleTarget(2, 1, 4)).toBe(3);
    expect(defaultScaleTarget(4, 1, 4)).toBe(3);
    expect(defaultScaleTarget(0, 2, 4)).toBe(2);
    expect(defaultScaleTarget(9, 2, 4)).toBe(4);
  });
});
