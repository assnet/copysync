import { Box, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon, TelegramIcon, WhatsAppIcon, brandColor, type BrandChannel } from '@/components';
import { PLAN_CATALOG, PLAN_HINTS, type PlanCatalogItem } from '../catalog';
import { linkRotationLimitParts, plansStrings } from '../strings';

const t = plansStrings.channels;

type LimitKey = keyof PlanCatalogItem['limits'];

interface ChannelColumn {
  channel: BrandChannel;
  label: string;
  icon: typeof WhatsAppIcon;
  /** Chaves de `limits` na ordem das linhas numéricas: sessões, monitorados, disparo. */
  keys: [LimitKey, LimitKey, LimitKey];
  /** Rodízio de links do canal: links e grupos por link. */
  rotation: [LimitKey, LimitKey];
}

const COLUMNS: ChannelColumn[] = [
  {
    channel: 'whatsapp', label: t.whatsapp, icon: WhatsAppIcon,
    keys: ['whatsappSessions', 'monitoredGroups', 'broadcastGroups'], rotation: ['linkRotations', 'linkRotationGroups'],
  },
  {
    channel: 'telegram', label: t.telegram, icon: TelegramIcon,
    keys: ['telegramSessions', 'telegramMonitoredGroups', 'telegramBroadcastGroups'], rotation: ['telegramLinkRotations', 'telegramLinkRotationGroups'],
  },
];

/** Linhas: as 3 primeiras são número (`keys[i]`); a última é o rodízio ("1 link" / "até 5 grupos"). */
const ROWS: { label: string; hint?: string; rotation?: boolean }[] = [
  { label: t.sessions },
  { label: t.monitoredGroups, hint: PLAN_HINTS.monitoredGroups },
  { label: t.broadcastGroups, hint: PLAN_HINTS.broadcastGroups },
  { label: t.linkRotation, hint: PLAN_HINTS.linkRotation, rotation: true },
];

/** Primeiro plano da vitrine que inclui o canal (ordem crescente do catálogo). */
function firstPlanWith(key: LimitKey): string | undefined {
  return PLAN_CATALOG.find((p) => p.limits[key] > 0)?.name;
}

const srOnly = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

/**
 * Limites do plano por canal em tabela semântica (linhas = recurso, colunas = canal). Canal fora do
 * plano vira uma célula única "A partir do X", sem traço nem "não incluso". O rodízio de links é a
 * última linha ("1 link" / "até 5 grupos" por canal); rodízio fora do plano num canal incluso vira
 * "A partir do X" só naquela célula.
 */
export function ChannelLimitsTable({ plan }: { plan: PlanCatalogItem }) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const line = `1px solid ${theme.palette.divider}`;

  return (
    <Box sx={{ border: line, borderRadius: '12px', overflow: 'hidden' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <Box component="caption" sx={srOnly}>{t.caption(plan.name)}</Box>
        <Box component="colgroup">
          <col />
          <Box component="col" sx={{ width: 84 }} />
          <Box component="col" sx={{ width: 84 }} />
        </Box>
        <Box component="thead" sx={{ bgcolor: alpha(theme.palette.text.primary, mode === 'dark' ? 0.05 : 0.03) }}>
          <tr>
            <Box component="th" scope="col" sx={{ ...srOnly }}>{t.resource}</Box>
            {COLUMNS.map((c) => {
              const included = plan.limits[c.keys[0]] > 0;
              return (
                <Box component="th" scope="col" key={c.channel} sx={{ px: 0.5, py: 1, fontWeight: 600 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                    <Box sx={{ display: 'flex', color: included ? brandColor(c.channel, mode) : 'text.disabled' }}>
                      <AppIcon icon={c.icon} size="sm" />
                    </Box>
                    <Typography component="span" variant="caption" sx={{ fontWeight: 700, lineHeight: 1.2, color: included ? 'text.primary' : 'text.secondary' }}>
                      {c.label}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </tr>
        </Box>
        <tbody>
          {ROWS.map((row, i) => {
            const label = (
              <Box
                component="th"
                scope="row"
                tabIndex={row.hint ? 0 : undefined}
                sx={{
                  px: 1.25, py: 0.875, textAlign: 'left', borderTop: line, fontWeight: 400, cursor: row.hint ? 'help' : 'default',
                  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography component="span" variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.3 }}>{row.label}</Typography>
                  {row.hint && <Box sx={{ color: 'text.disabled', display: 'flex', flexShrink: 0 }}><AppIcon icon={Info} size="sm" /></Box>}
                </Box>
              </Box>
            );
            return (
              <tr key={row.label}>
                {row.hint ? <Tooltip title={row.hint} enterTouchDelay={0} arrow placement="top">{label}</Tooltip> : label}
                {COLUMNS.map((c) => {
                  const included = plan.limits[c.keys[0]] > 0;
                  const cell = { px: 0.75, py: 0.875, textAlign: 'center', borderTop: line } as const;
                  if (included && row.rotation) {
                    const [linksKey, groupsKey] = c.rotation;
                    const links = plan.limits[linksKey];
                    if (links === 0) {
                      const from = firstPlanWith(linksKey);
                      return (
                        <Box component="td" key={c.channel} sx={cell}>
                          <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary', fontWeight: 600, lineHeight: 1.35 }}>
                            {from ? t.availableFrom(from) : null}
                          </Typography>
                        </Box>
                      );
                    }
                    const parts = linkRotationLimitParts(links, plan.limits[groupsKey]);
                    return (
                      <Box component="td" key={c.channel} sx={{ ...cell, px: 0.25, py: 0.75 }}>
                        <Box component="span" sx={srOnly}>{t.linkRotationAria(parts.links, parts.groups)}</Box>
                        <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <Typography component="span" variant="body2" sx={{ fontWeight: 700, color: 'text.primary', lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {parts.links}
                          </Typography>
                          <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {parts.groups}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  }
                  if (included) {
                    return (
                      <Box component="td" key={c.channel} sx={cell}>
                        <Typography component="span" variant="body2" sx={{ fontWeight: 700, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                          {plan.limits[c.keys[i]!].toLocaleString('pt-BR')}
                        </Typography>
                      </Box>
                    );
                  }
                  if (i > 0) return null;
                  const from = firstPlanWith(c.keys[0]);
                  return (
                    <Box
                      component="td"
                      key={c.channel}
                      rowSpan={ROWS.length}
                      sx={{ px: 0.75, py: 1, textAlign: 'center', verticalAlign: 'middle', borderTop: line, bgcolor: alpha(theme.palette.text.primary, mode === 'dark' ? 0.03 : 0.02) }}
                    >
                      <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary', fontWeight: 600, lineHeight: 1.35 }}>
                        {from ? t.availableFrom(from) : null}
                      </Typography>
                    </Box>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </Box>
    </Box>
  );
}
