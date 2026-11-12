/**
 * Ordem do boot das sessões (OWN-08): o keeper do lease liga **antes** do bootstrap. Bootstrap longo
 * com o keeper parado deixava o lease das primeiras sessões vencer e a renovação as derrubava. Com
 * o razão vazio a rodada do keeper não consulta o banco; aberturas em curso contam como locais.
 * `keeper` nulo = papel sem o job `leaseKeeper`.
 */
export async function bootSessionsWithKeeper(
  keeper: { start(): void } | null,
  bootSessions: () => Promise<void>,
): Promise<void> {
  keeper?.start();
  await bootSessions();
}
