import { isEngineMethod, type EngineCall } from './engineCallPlan';

/**
 * Codec JSON das chamadas da engine e seus resultados entre processos. Preserva o que JSON perde:
 * `Buffer` (base64, ex.: `OutboundLinkPreview.thumbnailJpeg`), `Uint8Array` (`waveform`), `Date` e `undefined`.
 * Marcador reservado: objeto com a chave `$wire`; um objeto de entrada com essa chave é rejeitado.
 */
const TAG = '$wire';

type Tagged =
  | { $wire: 'buf'; v: string }
  | { $wire: 'u8'; v: string }
  | { $wire: 'date'; v: string }
  | { $wire: 'undef' };

function toWire(value: unknown): unknown {
  if (value === undefined) return { [TAG]: 'undef' };
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError(`engine codec: tipo ${typeof value} não serializável`);
    }
    return value;
  }
  if (Buffer.isBuffer(value)) return { [TAG]: 'buf', v: value.toString('base64') };
  if (value instanceof Uint8Array) return { [TAG]: 'u8', v: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('engine codec: Date inválida');
    return { [TAG]: 'date', v: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(toWire);
  if (Object.prototype.hasOwnProperty.call(value, TAG)) throw new TypeError(`engine codec: chave reservada ${TAG}`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = toWire(v); // ausente ≡ undefined em objeto
  }
  return out;
}

function fromWire(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(fromWire);
  const obj = value as Record<string, unknown>;
  if (TAG in obj) {
    const t = obj as Tagged;
    switch (t.$wire) {
      case 'undef': return undefined;
      case 'buf': return Buffer.from(t.v, 'base64');
      case 'u8': return new Uint8Array(Buffer.from(t.v, 'base64'));
      case 'date': return new Date(t.v);
      default: throw new TypeError(`engine codec: marcador desconhecido ${String((t as { $wire: unknown }).$wire)}`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fromWire(v);
  return out;
}

/** Valor qualquer (resultado de método) → string JSON. */
export function encodeEngineValue(value: unknown): string {
  return JSON.stringify(toWire(value));
}

export function decodeEngineValue<T = unknown>(raw: string): T {
  return fromWire(JSON.parse(raw)) as T;
}

export function encodeEngineCall(call: EngineCall): string {
  return encodeEngineValue({ method: call.method, args: call.args });
}

/** Valida forma mínima (método conhecido, args em lista); argumentos não são validados um a um. */
export function decodeEngineCall(raw: string): EngineCall {
  const parsed = decodeEngineValue<{ method?: unknown; args?: unknown }>(raw);
  if (!parsed || typeof parsed !== 'object' || !isEngineMethod(parsed.method) || !Array.isArray(parsed.args)) {
    throw new TypeError('engine codec: chamada inválida');
  }
  return { method: parsed.method, args: parsed.args } as EngineCall;
}
