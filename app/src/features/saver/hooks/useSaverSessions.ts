import { useTenant } from '@/contexts/TenantContext';
import { sessionService } from '@/services/session.service';
import type { SessionItem } from '@/types/api.types';
import { useSaverResource, type SaverResource } from './useSaverResource';

/** Sessões do tenant para o seletor da tela Grupos (WhatsApp e Telegram; a tela avisa sobre Telegram). */
export function useSaverSessions(): SaverResource<SessionItem[]> {
  const { activeTenantId } = useTenant();
  return useSaverResource(`sessions:${activeTenantId ?? ''}`, async () => (await sessionService.list()).sessions ?? []);
}
