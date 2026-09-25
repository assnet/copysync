/** Quantidade de barras da forma de onda de uma mensagem de voz no WhatsApp. */
const BARS = 64;

/**
 * Forma de onda de uma mensagem de voz: 64 valores de 0 a 100.
 *
 * Mesmo algoritmo do Baileys (`getAudioWaveform`): divide os níveis em 64 blocos
 * de tamanho `floor(n / 64)` (o resto do fim é descartado), tira a média do valor
 * absoluto de cada bloco, normaliza pelo bloco mais alto e aplica `floor(100 · x)`.
 *
 * Diferenças deliberadas, todas para nunca devolver `NaN`:
 * - normaliza dividindo pelo máximo, e não multiplicando pelo inverso — `49 · (1/49)`
 *   dá `0.999…` e o pico sairia 99;
 * - silêncio (máximo zero) e entrada vazia → 64 zeros;
 * - menos de 64 níveis → a onda é esticada: a barra `i` repete o nível
 *   `floor(i · n / 64)` (no Baileys o bloco teria tamanho zero e a média seria `0/0`).
 */
export function buildWaveform(levels: ArrayLike<number>): Uint8Array {
  const total = levels.length;
  const waveform = new Uint8Array(BARS);
  if (total === 0) return waveform;

  const averages = new Array<number>(BARS);
  if (total < BARS) {
    for (let i = 0; i < BARS; i++) averages[i] = Math.abs(levels[Math.floor((i * total) / BARS)]);
  } else {
    const blockSize = Math.floor(total / BARS);
    for (let i = 0; i < BARS; i++) {
      const start = i * blockSize;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) sum += Math.abs(levels[start + j]);
      averages[i] = sum / blockSize;
    }
  }

  const max = Math.max(...averages);
  if (max === 0) return waveform;
  for (let i = 0; i < BARS; i++) waveform[i] = Math.floor((100 * averages[i]) / max);
  return waveform;
}
