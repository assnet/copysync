import { RefreshCw } from 'lucide-react';
import { Box, Button, ButtonBase, Skeleton, Tooltip, Typography, useTheme } from '@mui/material';
import { AppIcon } from '@/components';
import { formatCount, formatShare } from './format';
import { BRAZIL_DDI, countryName, dddRegion } from './phoneRegions';
import {
  NUMERIC, REDUCED_MOTION, VISUALLY_HIDDEN, focusRingSx, panelSx, toneFill, trackColor, type RegionTone,
} from './platformContactsStyle';
import { saverAdminStrings as s } from './strings';
import { EMPTY_PLATFORM_FILTERS, type PlatformContactFilters, type PlatformContactsSummary as Summary } from './types';
import type { PlatformContactsSummaryState } from './usePlatformContactsSummary';

interface Props {
  /** Contagem + os filtros a que ela responde (tipo da distribuição e barra ativa vêm daí, nunca do filtro novo). */
  state: PlatformContactsSummaryState;
  onPickDdi: (ddi: string) => void;
  onPickDdd: (ddd: string) => void;
}

interface TileProps {
  label: string;
  hint: string;
  value: number | null;
  note?: string | null;
  tone?: RegionTone;
  loading: boolean;
  testId: string;
}

function Tile({ label, hint, value, note, tone, loading, testId }: TileProps) {
  const theme = useTheme();
  return (
    <Box data-testid={testId} sx={{ p: { xs: 1.75, sm: 2.25 }, minWidth: 0, bgcolor: 'background.paper' }}>
      <Tooltip title={hint} arrow placement="top-start" describeChild>
        <Typography component="h3" variant="body2" color="text.secondary" tabIndex={0} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, cursor: 'help', borderRadius: 1, ...focusRingSx(theme) }}>
          {tone && <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: toneFill(theme, tone, true), flexShrink: 0 }} />}
          {label}
        </Typography>
      </Tooltip>
      {loading || value === null ? (
        <Skeleton variant="text" width="60%" sx={{ fontSize: { xs: '1.5rem', sm: '1.875rem' }, lineHeight: 1.2 }} />
      ) : (
        <Typography component="p" sx={{ ...NUMERIC, fontSize: { xs: '1.5rem', sm: '1.875rem' }, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>
          {formatCount(value)}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', minHeight: '1.4em', mt: 0.25 }}>
        {loading ? '' : note ?? ''}
      </Typography>
    </Box>
  );
}

interface Bar { value: string; code: string; name: string; count: number; active: boolean; action: string }

function Distribution({ title, bars, base, disabled, onPick }: { title: string; bars: Bar[]; base: number; disabled: boolean; onPick: (code: string) => void }) {
  const theme = useTheme();
  const max = Math.max(...bars.map((b) => b.count), 1);
  return (
    <Box component="section" aria-label={title} sx={{ p: { xs: 1.75, sm: 2.25 }, minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 2 }}>
        <Typography component="h3" variant="body2" color="text.secondary">{title}</Typography>
        {bars.length > 0 && <Typography variant="caption" color="text.secondary">{disabled ? s.summary.updating : s.summary.distributionHint}</Typography>}
      </Box>
      {bars.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{s.summary.distributionEmpty}</Typography>
      ) : (
        // Duas colunas em tela larga, lidas de cima para baixo (a ordem do ranking desce a 1ª coluna e segue na 2ª).
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 0.75, columnCount: { xs: 1, md: bars.length > 2 ? 2 : 1 }, columnGap: 5 }}>
          {bars.map((b) => {
            const share = formatShare(b.count, base);
            return (
              <Box component="li" key={b.value} sx={{ breakInside: 'avoid', py: 0.125 }}>
                {/* Resumo de outros filtros (carregando o novo): a barra não aplica nada; sem Tooltip em botão desabilitado. */}
                <Tooltip title={disabled ? '' : b.active ? s.summary.removeFilter : b.action} arrow placement="top" describeChild>
                  <ButtonBase
                    disabled={disabled}
                    onClick={() => onPick(b.active ? '' : b.value)}
                    aria-pressed={b.active}
                    aria-label={`${b.action}. ${s.summary.barValue(b.count, share)}`}
                    data-testid="summary-bar"
                    sx={{
                      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1.5, rowGap: 0.5, alignItems: 'baseline',
                      width: 'calc(100% + 16px)', textAlign: 'left', px: 1, py: 0.75, mx: -1, borderRadius: '10px',
                      transition: 'background-color 120ms', [REDUCED_MOTION]: { transition: 'none' },
                      bgcolor: b.active ? toneFill(theme, 'primary') : 'transparent',
                      '&:hover': { bgcolor: b.active ? toneFill(theme, 'primary') : 'action.hover' },
                      ...focusRingSx(theme),
                    }}
                  >
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      <Box component="span" sx={{ ...NUMERIC, fontWeight: 700, mr: 0.75 }}>{b.code}</Box>
                      <Box component="span" sx={{ color: 'text.secondary' }}>{b.name}</Box>
                    </Typography>
                    <Typography variant="body2" sx={{ ...NUMERIC, fontWeight: 600 }}>
                      {formatCount(b.count)}
                      {share && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.75 }}>{share}</Box>}
                    </Typography>
                    <Box aria-hidden sx={{ gridColumn: '1 / -1', height: 6, borderRadius: 3, bgcolor: trackColor(theme), overflow: 'hidden' }}>
                      <Box sx={{ width: `${Math.max((b.count / max) * 100, 1.5)}%`, height: '100%', borderRadius: 3, bgcolor: toneFill(theme, 'primary', true) }} />
                    </Box>
                  </ButtonBase>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function bars(data: Summary, filters: PlatformContactFilters): { title: string; list: Bar[]; byDdd: boolean } {
  if (filters.ddi === BRAZIL_DDI) {
    return {
      title: s.summary.dddTitle,
      byDdd: true,
      list: data.topDdd.map((d) => ({
        value: d.ddd, code: d.ddd, name: dddRegion(d.ddd), count: d.count, active: filters.ddd === d.ddd, action: s.summary.applyDdd(d.ddd, dddRegion(d.ddd)),
      })),
    };
  }
  return {
    title: s.summary.ddiTitle,
    byDdd: false,
    list: data.topDdi.map((d) => ({
      value: d.ddi, code: `+${d.ddi}`, name: countryName(d.ddi), count: d.count, active: filters.ddi === d.ddi, action: s.summary.applyDdi(countryName(d.ddi), d.ddi),
    })),
  };
}

/**
 * Indicadores no topo: uma faixa com total da base, encontrados, com telefone × só LID e, abaixo, a
 * distribuição por país (ou por DDD, com o Brasil filtrado). Só contagem agregada: nada aqui é dado de
 * contato, então não borra. Enquanto uma contagem nova carrega, a anterior fica na tela inteira (esmaecida)
 * com os filtros DELA; falha vira aviso discreto com "tentar de novo". A lista não depende disto. Sem região
 * `aria-live` própria: quem anuncia a troca de filtro é o rodapé da lista.
 */
export function PlatformContactsSummary({ state, onPickDdi, onPickDdd }: Props) {
  const theme = useTheme();
  const { data, filters, loading, failed, reload } = state;

  if (failed) {
    return (
      <Box role="status" sx={{ ...panelSx(theme), px: 2, py: 1.25, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">{s.summary.error}</Typography>
        <Button size="small" onClick={reload} startIcon={<AppIcon icon={RefreshCw} size="inline" />}>{s.summary.retry}</Button>
      </Box>
    );
  }

  const ready = data !== null && filters !== null;
  const dist = ready ? bars(data, filters) : null;
  const narrowed = ready && JSON.stringify(filters) !== JSON.stringify(EMPTY_PLATFORM_FILTERS);
  const split = ready && data.filtered > 0 ? (data.withPhone / data.filtered) * 100 : null;
  const share = (part: number) => (ready ? formatShare(part, data.filtered) : null);

  return (
    <Box
      component="section"
      aria-label={s.summary.label}
      aria-busy={loading}
      sx={{ ...panelSx(theme), overflow: 'hidden', opacity: loading && ready ? 0.6 : 1, transition: 'opacity 160ms', [REDUCED_MOTION]: { transition: 'none' } }}
    >
      {/* Divisórias = o fundo `divider` aparecendo no vão de 1 px entre os indicadores (vale para 2×2 e 4×1). */}
      <Box sx={{ display: 'grid', gap: '1px', bgcolor: 'divider', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
        <Tile testId="summary-total" label={s.summary.total} hint={s.summary.totalHint} value={data?.total ?? null} loading={!ready} />
        <Tile
          testId="summary-filtered" label={s.summary.filtered} hint={s.summary.filteredHint} value={data?.filtered ?? null} loading={!ready}
          note={ready ? (narrowed ? s.summary.shareOfBase(formatShare(data.filtered, data.total) ?? '0%') : s.summary.noFilters) : null}
        />
        <Tile
          testId="summary-with-phone" label={s.summary.withPhone} hint={s.summary.withPhoneHint} value={data?.withPhone ?? null} loading={!ready} tone="success"
          note={ready && share(data.withPhone) ? s.summary.shareOfFiltered(share(data.withPhone)!) : null}
        />
        <Tile
          testId="summary-lid-only" label={s.summary.lidOnly} hint={s.summary.lidOnlyHint} value={data?.lidOnly ?? null} loading={!ready} tone="warning"
          note={ready && share(data.lidOnly) ? s.summary.shareOfFiltered(share(data.lidOnly)!) : null}
        />
      </Box>
      {/* Partição com telefone × só LID numa barra só; os números estão nos dois indicadores acima. */}
      <Box aria-hidden sx={{ display: 'flex', height: 6, bgcolor: trackColor(theme) }}>
        {split !== null && (
          <>
            <Box sx={{ width: `${split}%`, bgcolor: toneFill(theme, 'success', true) }} />
            <Box sx={{ flex: 1, bgcolor: toneFill(theme, 'warning', true) }} />
          </>
        )}
      </Box>
      {dist && ready ? (
        <Distribution title={dist.title} bars={dist.list} base={dist.byDdd ? data.dddBase : data.ddiBase} disabled={!state.current} onPick={dist.byDdd ? onPickDdd : onPickDdi} />
      ) : (
        <Box sx={{ p: { xs: 1.75, sm: 2.25 } }} data-testid="summary-distribution-loading">
          <Box component="span" sx={VISUALLY_HIDDEN}>{s.summary.updating}</Box>
          <Skeleton variant="text" width={200} sx={{ maxWidth: '60%' }} />
          <Box aria-hidden sx={{ display: 'grid', gap: 1, columnGap: 5, mt: 1, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={34} />)}
          </Box>
        </Box>
      )}
    </Box>
  );
}
