import {
  Box, Card, CardContent, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography, alpha,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { HeaderHint, srOnly, StickyFirstColumn } from '@/features/infraCosts/components/costParts';
import {
  adoptionCell, buildPlanMatrix, featureLabel, recurringCell, formatInteger, formatPlanCell, formatReach, planLabel,
  type PlanMatrixCell,
} from '../rules';
import { usageFeaturePath } from '../paths';
import { featureUsageStrings as S } from '../strings';
import type { UsagePlanFamily, UsageRecurringDays, UsageSort, UsageSummary } from '../types';
import { RatioValue } from './RatioValue';

const t = S.plansTab;

interface PlanMatrixTableProps {
  summary: Pick<UsageSummary, 'population' | 'features'>;
  /** Famílias com recurso no recorte (ordem fixa). Com uma só, o seletor some. */
  families: UsagePlanFamily[];
  family: UsagePlanFamily;
  onFamilyChange: (family: UsagePlanFamily) => void;
  sort: UsageSort;
  /** N da recorrência pedido ao resumo. */
  recurringDays?: UsageRecurringDays;
}

/** Célula: "2 de 5" + alcance e usos; plano sem conta = "—" com dica (nunca "0%"). */
function MatrixCell({ feature, cell }: { feature: string; cell: PlanMatrixCell }) {
  if (cell.share === null) {
    return (
      <TableCell align="right">
        <Tooltip title={t.noTenantsHint} arrow enterTouchDelay={0} describeChild>
          <Box component="span" tabIndex={0} sx={{ color: 'text.disabled', cursor: 'help' }}>{t.noTenants}</Box>
        </Tooltip>
      </TableCell>
    );
  }
  const plan = planLabel(cell.plan);
  const label = t.cellAria(feature, plan, formatInteger(cell.activeTenants), formatInteger(cell.tenants), formatInteger(cell.uses));
  return (
    <TableCell
      align="right"
      data-plan={cell.plan}
      sx={{
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        // Fundo proporcional ao alcance: reforço visual; o número está sempre escrito.
        bgcolor: (th) => (cell.share ? alpha(th.palette.primary.main, 0.04 + cell.share * (th.palette.mode === 'dark' ? 0.22 : 0.16)) : undefined),
      }}
    >
      <Typography variant="body2" component="span" sx={{ fontWeight: 600, display: 'block' }} aria-hidden>
        {formatPlanCell(cell)}
      </Typography>
      <Typography variant="caption" component="span" color="text.secondary" sx={{ display: 'block' }} aria-hidden>
        <span>{formatReach(cell.share)}</span>
        <Box component="span" sx={{ ml: 1 }}>{t.uses(formatInteger(cell.uses))}</Box>
      </Typography>
      <Box component="span" sx={srOnly}>{label}</Box>
    </TableCell>
  );
}

/**
 * Recurso × plano de uma família por vez: contas que usaram ÷ contas do plano (denominador em
 * `population.byPlan` da mesma família) e usos, mais adoção e recorrência do recurso (P3). Primeira coluna fixa;
 * nenhuma linha soma as famílias.
 */
export function PlanMatrixTable({ summary, families, family, onFamilyChange, sort, recurringDays = 3 }: PlanMatrixTableProps) {
  const matrix = buildPlanMatrix(summary, family, sort);
  const c = S.ranking.columns;
  const familyName = S.planFamilies[family];
  return (
    <Card>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between', mb: 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>{t.title}</Typography>
            <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
          </Box>
          {families.length > 1 && (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={family}
                aria-label={t.family}
                onChange={(_, value: UsagePlanFamily | null) => value && onFamilyChange(value)}
              >
                {families.map((f) => <ToggleButton key={f} value={f}>{S.planFamilies[f]}</ToggleButton>)}
              </ToggleButtonGroup>
              <HelpTip label={t.family} text={t.familyHint} />
            </Stack>
          )}
        </Stack>
        {matrix.rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t.empty}</Typography>
        ) : (
          <StickyFirstColumn>
            <Table size="small" aria-label={t.aria(familyName)} sx={{ minWidth: 120 + (matrix.columns.length + 2) * 120 }}>
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">{t.featureColumn}</TableCell>
                  {matrix.columns.map((col) => (
                    <TableCell key={col.plan} component="th" scope="col" align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {col.plan === 'NONE'
                        ? <HeaderHint label={planLabel(col.plan)} hint={t.noneColumnHint} />
                        : planLabel(col.plan)}
                      <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'block', fontWeight: 400 }}>
                        {t.planTenants(formatInteger(col.tenants))}
                      </Typography>
                    </TableCell>
                  ))}
                  {/* Medidas do recurso (não por plano): o direito e a recorrência vêm do recurso inteiro. */}
                  <TableCell component="th" scope="col" align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <HeaderHint label={c.adoption} hint={S.retention.adoptionHelp} />
                  </TableCell>
                  <TableCell component="th" scope="col" align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <HeaderHint label={c.recurring} hint={S.retention.recurringHelp(recurringDays)} />
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {matrix.rows.map((row) => {
                  const name = featureLabel(row.key);
                  const feature = summary.features.find((f) => f.key === row.key);
                  return (
                    <TableRow key={row.key} hover>
                      <TableCell component="th" scope="row" sx={{ minWidth: 120, maxWidth: 200 }}>
                        <Link component={RouterLink} to={usageFeaturePath(row.key)} underline="hover" color="inherit" sx={{ fontWeight: 500 }}>
                          {name}
                        </Link>
                      </TableCell>
                      {row.cells.map((cell) => <MatrixCell key={cell.plan} feature={name} cell={cell} />)}
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {feature && <RatioValue cell={adoptionCell(feature)} label={c.adoption} />}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {feature && <RatioValue cell={recurringCell(feature, recurringDays)} label={c.recurring} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </StickyFirstColumn>
        )}
      </CardContent>
    </Card>
  );
}
