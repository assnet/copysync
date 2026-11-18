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

/** Só testes: zera a reserva em memória. */
export function resetPageViewMarks(): void {
  memoryMarks = { day: '', marks: [] };
}

/**
 * Registra a visita da tela do menu ativa (`menuKey` = chave de `buildNavigation`). No máximo uma chamada por
 * dia (Brasília, relógio do servidor) × conta × tela por aba. Não envia para super admin, sem conta ativa nem para
 * tela fora da lista. Fire-and-forget: nunca bloqueia a navegação nem mostra erro (429 e falha de rede são
 * ignorados; o servidor é idempotente, então perder ou repetir uma marca não muda o número).
 */
export function usePageViewReporter(menuKey: string | null | undefined, options: { isSuperAdmin: boolean; tenantId: string | null }): void {
  const { isSuperAdmin, tenantId } = options;
  useEffect(() => {
    if (isSuperAdmin || !tenantId) return;
    const key = screenViewKeyOf(menuKey);
    if (!key) return;
    const current = readMarks(screenViewDay(serverNow()));
    const mark = `${tenantId}|${key}`;
    if (current.marks.includes(mark)) return;
    // Marca antes de enviar: o duplo efeito do StrictMode e trocas rápidas não geram segunda chamada.
    writeMarks({ day: current.day, marks: [...current.marks, mark] });
    usagePageViewsService.report(key).catch(() => undefined);
  }, [menuKey, isSuperAdmin, tenantId]);
}
