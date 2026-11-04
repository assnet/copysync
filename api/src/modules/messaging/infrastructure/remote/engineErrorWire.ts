import { AppError } from '../../../../shared/errors/AppError';
import * as GroupErrors from '../../../../shared/errors/internal/GroupErrors';
import * as MediaErrors from '../../../../shared/errors/internal/MediaErrors';
import * as MessagingErrors from '../../../../shared/errors/internal/MessagingErrors';
import { EngineTemporarilyUnavailableError } from '../../../../shared/errors/internal/MessagingErrors';
import * as SessionErrors from '../../../../shared/errors/internal/SessionErrors';
import * as TelegramErrors from '../../../../shared/errors/internal/TelegramErrors';

/**
 * Erro da engine no fio entre processos (WROLE-10): worker → http pelo Redis/BullMQ.
 * `name` desempata classes de mesmo `code` (ex.: `SessionLeaseHeldError` × `EngineTemporarilyUnavailableError`);
 * `fields` leva campos próprios primitivos da classe (ex.: `sessionId`). Nunca carrega stack.
 */
export interface WireError {
  code: string;
  message: string;
  statusCode: number;
  meta?: Record<string, unknown>;
  name?: string;
  fields?: Record<string, string | number | boolean>;
}

type AppErrorClass = abstract new (...args: never[]) => AppError;

const BASE_KEYS = new Set(['code', 'statusCode', 'meta', 'name', 'message', 'stack']);

/** Ordem importa: no mesmo `code`, a primeira classe vira o padrão (base antes de subclasse). */
const REGISTERED_MODULES: ReadonlyArray<Record<string, unknown>> = [
  MessagingErrors,
  SessionErrors,
  MediaErrors,
  TelegramErrors,
  GroupErrors,
];

interface Entry { ctor: AppErrorClass; code: string; statusCode: number }
const byName = new Map<string, Entry>();
const byCode = new Map<string, Entry>();

for (const mod of REGISTERED_MODULES) {
  for (const value of Object.values(mod)) {
    if (typeof value !== 'function' || !(value.prototype instanceof AppError)) continue;
    const ctor = value as AppErrorClass;
    let probe: AppError;
    try {
      // Só para ler `code`/`statusCode` fixos da classe; construtores daqui aceitam argumentos ausentes.
      probe = new (ctor as unknown as new () => AppError)();
    } catch {
      continue;
    }
    const entry = { ctor, code: probe.code, statusCode: probe.statusCode };
    byName.set(ctor.name, entry);
    if (!byCode.has(entry.code)) byCode.set(entry.code, entry);
  }
}

/** Classe registrada para o fio (usado em teste para garantir cobertura dos módulos). */
export function isWireRegistered(ctor: AppErrorClass): boolean {
  return byName.get(ctor.name)?.ctor === ctor;
}

function ownPrimitiveFields(err: AppError): WireError['fields'] {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(err)) {
    if (BASE_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Só `AppError` atravessa com código e mensagem; qualquer outro erro vira 503 genérico, sem texto cru. */
export function toWireError(err: unknown): WireError {
  if (!(err instanceof AppError)) return toWireError(new EngineTemporarilyUnavailableError());
  const wire: WireError = { code: err.code, message: err.message, statusCode: err.statusCode, name: err.name };
  if (err.meta) wire.meta = err.meta;
  const fields = ownPrimitiveFields(err);
  if (fields) wire.fields = fields;
  return wire;
}

/** Remonta a mesma classe interna por `name`/`code` (status vem da classe); desconhecido → `EngineTemporarilyUnavailableError`. */
export function fromWireError(wire: unknown): AppError {
  const w = (wire ?? {}) as Partial<WireError>;
  const code = typeof w.code === 'string' ? w.code : '';
  const named = typeof w.name === 'string' ? byName.get(w.name) : undefined;
  const entry = named && named.code === code ? named : byCode.get(code);
  if (!entry || typeof w.message !== 'string') return new EngineTemporarilyUnavailableError();
  const { ctor } = entry;

  // Sem chamar o construtor: ele formata a mensagem; aqui ela já vem pronta do outro processo.
  const err = Object.create(ctor.prototype) as AppError & Record<string, unknown>;
  const define = (key: string, value: unknown) =>
    Object.defineProperty(err, key, { value, enumerable: key !== 'message', writable: true, configurable: true });
  define('message', w.message);
  define('name', ctor.name);
  define('code', code);
  define('statusCode', entry.statusCode); // da classe, não do fio
  define('meta', w.meta && typeof w.meta === 'object' ? w.meta : undefined);
  if (w.fields && typeof w.fields === 'object') {
    for (const [key, value] of Object.entries(w.fields)) {
      if (!BASE_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) define(key, value);
    }
  }
  define('stack', `${ctor.name}: ${w.message}`);
  return err;
}
