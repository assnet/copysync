import type { GroupMonitorConfig, GroupMonitorSettings } from '../../domain/entities/GroupMonitor';
import type { MonitorSettingsWithWeekdays } from '../../domain/services/monitorSettings';
import { weekdaysFromMask, weekdaysMask } from '../../../campaigns/domain/services/postingWindow';

/** Linha de `group_monitor_configs` lida pelo repositório (dias guardados como mask). */
export type GroupMonitorConfigRow = GroupMonitorSettings & { id: string; tenantId: string; sessionId: string; weekdaysMask: number };

/** Colunas gravadas: `weekdays` vira `weekdaysMask`; ausente = não grava (mantém o salvo; na criação vale o `@default` 127). */
export type GroupMonitorSettingsData = GroupMonitorSettings & { weekdaysMask?: number };

/** Prisma ↔ monitoramento. Mask ↔ lista de dias só aqui. */
export const PrismaGroupMonitorMapper = {
  toConfig(r: GroupMonitorConfigRow): GroupMonitorConfig {
    return {
      id: r.id, tenantId: r.tenantId, sessionId: r.sessionId, enabled: r.enabled,
      windowStartMinute: r.windowStartMinute, windowEndMinute: r.windowEndMinute, captureOutsideWindow: r.captureOutsideWindow,
      weekdays: weekdaysFromMask(r.weekdaysMask),
      intervalMinSeconds: r.intervalMinSeconds, intervalMaxSeconds: r.intervalMaxSeconds,
      startDelaySeconds: r.startDelaySeconds, maxOfferAgeMinutes: r.maxOfferAgeMinutes, couponMaxAgeMinutes: r.couponMaxAgeMinutes,
      mentionAll: r.mentionAll, simulateTyping: r.simulateTyping, typingSeconds: r.typingSeconds,
      textMode: r.textMode, audience: r.audience, enrichLinkOnly: r.enrichLinkOnly, imageMode: r.imageMode,
    };
  },

  /** Lista explícita de campos: nada além das colunas chega ao Prisma. Dia fora de 0..6 lança (validado antes no use case). */
  toSettingsData(s: MonitorSettingsWithWeekdays): GroupMonitorSettingsData {
    const data: GroupMonitorSettingsData = {
      enabled: s.enabled, windowStartMinute: s.windowStartMinute, windowEndMinute: s.windowEndMinute,
      captureOutsideWindow: s.captureOutsideWindow, intervalMinSeconds: s.intervalMinSeconds, intervalMaxSeconds: s.intervalMaxSeconds,
      startDelaySeconds: s.startDelaySeconds, maxOfferAgeMinutes: s.maxOfferAgeMinutes, couponMaxAgeMinutes: s.couponMaxAgeMinutes,
      mentionAll: s.mentionAll, simulateTyping: s.simulateTyping, typingSeconds: s.typingSeconds,
      textMode: s.textMode, audience: s.audience, enrichLinkOnly: s.enrichLinkOnly, imageMode: s.imageMode,
    };
    if (s.weekdays !== undefined) data.weekdaysMask = weekdaysMask(s.weekdays);
    return data;
  },
};
