import { useEffect } from 'react';
import { serverNow } from '@/services/serverClock';
import { usagePageViewsService } from '@/services/usagePageViews.service';
import { screenViewDay, screenViewKeyOf } from '../screenViews';

/** Marcas da aba: `{ day, marks: ["<tenantId>|<view:key>"] }`. Dia novo descarta as marcas do anterior. */
export const PAGE_VIEW_MARKS_KEY = 'usage.pageViews';

interface PageViewMarks {
  day: string;
  marks: string[];
}

/** Reserva quando o `sessionStorage` não está disponível (modo privado, bloqueio): vale até recarregar a aba. */
let memoryMarks: PageViewMarks = { day: '', marks: [] };

function readMarks(day: string): PageViewMarks {
  let stored: PageViewMarks = memoryMarks;
  try {
    const raw = sessionStorage.getItem(PAGE_VIEW_MARKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PageViewMarks>;
      if (typeof parsed.day === 'string' && Array.isArray(parsed.marks)) {
        stored = { day: parsed.day, marks: parsed.marks.filter((m): m is string => typeof m === 'string') };
      }
    }
  } catch {
    // storage indisponível ou corrompido: segue com a reserva em memória
  }
  return stored.day === day ? stored : { day, marks: [] };
}

function writeMarks(marks: PageViewMarks): void {
  memoryMarks = marks;
  try {
    sessionStorage.setItem(PAGE_VIEW_MARKS_KEY, JSON.stringify(marks));
  } catch {
    // ignora: a reserva em memória já tem a marca
  }
}

/** Envios em voo (`<dia>|<tenantId>|<view:key>`): segura o duplo efeito do StrictMode e trocas rápidas sem gravar marca. */
const inFlight = new Set<string>();

/** Só testes: zera a reserva em memória e os envios em voo. */
export function resetPageViewMarks(): void {
  memoryMarks = { day: '', marks: [] };
  inFlight.clear();
}

/**
 * Registra a visita da tela do menu ativa (`menuKey` = chave de `buildNavigation`). No máximo uma chamada por
 * dia (Brasília, relógio do servidor) × conta × tela por aba. Não envia para super admin, sem conta ativa nem para
 * tela fora da lista. Fire-and-forget: nunca bloqueia a navegação nem mostra erro. A marca do dia só é gravada
 * após a resposta de sucesso (204); enquanto o envio está em voo, a deduplicação é só em memória. Falha, 429 ou
 * timeout não gravam marca: a próxima visita à tela tenta de novo (o servidor é idempotente, repetir não soma).
 *
 * Usa o `apiClient` comum e por isso herda os efeitos globais dele (401 renova/encerra a sessão, conta suspensa
 * redireciona). Aceito: são os mesmos efeitos de qualquer outra chamada da tela aberta.
 */
export function usePageViewReporter(menuKey: string | null | undefined, options: { isSuperAdmin: boolean; tenantId: string | null }): void {
  const { isSuperAdmin, tenantId } = options;
  useEffect(() => {
    if (isSuperAdmin || !tenantId) return;
    const key = screenViewKeyOf(menuKey);
    if (!key) return;
    const day = screenViewDay(serverNow());
    const mark = `${tenantId}|${key}`;
    if (readMarks(day).marks.includes(mark)) return;
    const flightKey = `${day}|${mark}`;
    if (inFlight.has(flightKey)) return;
    inFlight.add(flightKey);
    usagePageViewsService
      .report(key)
      .then(() => {
        const latest = readMarks(day);
        if (!latest.marks.includes(mark)) writeMarks({ day, marks: [...latest.marks, mark] });
      })
      .catch(() => undefined)
      .finally(() => inFlight.delete(flightKey));
  }, [menuKey, isSuperAdmin, tenantId]);
}
