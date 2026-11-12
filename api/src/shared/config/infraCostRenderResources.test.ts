import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from './env';
import { parseInfraCostRenderResources } from './infraCostRenderResources';

const log = () => ({ warn: vi.fn() });

describe('INFRA_COST_RENDER_RESOURCES', () => {
  it('lê chave=id dos cinco recursos com o prefixo certo', () => {
    const l = log();
    const map = parseInfraCostRenderResources(
      ' api=srv-teste1, worker=srv-teste2 ,redis=red-teste3,postgres=dpg-teste4,static=srv-teste5', undefined, l,
    );
    expect(Object.fromEntries(map)).toEqual({
      api: 'srv-teste1', worker: 'srv-teste2', redis: 'red-teste3', postgres: 'dpg-teste4', static: 'srv-teste5',
    });
    expect(l.warn).not.toHaveBeenCalled();
  });

  it('ignora entrada inválida com warn sem o id nem o texto cru', () => {
    const l = log();
    const map = parseInfraCostRenderResources(
      'api=srv-teste,lixo,banco=dpg-teste,postgres=srv-teste,redis=red-TESTE,api=srv-outro,=srv-x', undefined, l,
    );
    expect(Object.fromEntries(map)).toEqual({ api: 'srv-teste' });
    const issues = l.warn.mock.calls.map(([o]) => (o as { issue: string }).issue);
    expect(issues).toEqual(['malformed_entry', 'unknown_key', 'invalid_id', 'invalid_id', 'duplicate_key', 'malformed_entry']);
    const logged = JSON.stringify(l.warn.mock.calls);
    expect(logged).not.toMatch(/srv-|dpg-|red-|lixo|banco/);
  });

  it('usa WORKER_SCALER_SERVICE_ID quando falta worker=, só se válido', () => {
    expect(parseInfraCostRenderResources('api=srv-teste', 'srv-teste', log()).get('worker')).toBe('srv-teste');
    expect(parseInfraCostRenderResources('worker=srv-teste', 'srv-outro', log()).get('worker')).toBe('srv-teste');
    expect(parseInfraCostRenderResources(undefined, 'dpg-teste', log()).size).toBe(0);
    expect(parseInfraCostRenderResources(undefined, undefined, log()).size).toBe(0);
  });

  it('env opcional: vazia vira ausente e não derruba o boot', () => {
    const r = parseEnv({ ...process.env, INFRA_COST_RENDER_RESOURCES: '  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.INFRA_COST_RENDER_RESOURCES).toBeUndefined();
  });
});
