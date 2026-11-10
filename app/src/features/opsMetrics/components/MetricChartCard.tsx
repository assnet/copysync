import { useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Card, Divider, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, Tooltip, Typography,
} from '@mui/material';
import { ChartLine, Table2 } from 'lucide-react';
import { AppIcon, EmptyState } from '@/components';
import { opsMetricsStrings as t } from '../strings';
import { HelpTip } from './HelpTip';

export interface ChartTable {
  headers: string[];
  rows: string[][];
}

interface Props {
  title: string;
  unit: string;
  help?: string;
  note?: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Sem amostras: mensagem do estado vazio (padrão "Sem amostras neste período"). */
  empty?: boolean;
  emptyText?: string;
  figureAria: string;
  table: ChartTable;
  /** Sem gráfico (ex.: mais de 3 workers): só a tabela, com aviso. */
  tableOnlyNotice?: string;
  children?: ReactNode;
}

const PLOT_HEIGHT = { xs: 180, md: 220 } as const;

/** Cartão de gráfico com alternância gráfico ↔ tabela (caminho acessível) e estados próprios. */
export function MetricChartCard({
  title, unit, help, note, loading, error, onRetry, empty, emptyText, figureAria, table, tableOnlyNotice, children,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const tableOnly = Boolean(tableOnlyNotice);
  const asTable = tableOnly || showTable;
  const canToggle = !loading && !error && !empty && !tableOnly;

  let body: ReactNode;
  if (loading) {
    body = <Skeleton variant="rounded" sx={{ height: PLOT_HEIGHT }} />;
  } else if (error) {
    body = (
      <Alert
        severity="error"
        action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>{t.retry}</Button>}
      >
        {t.charts.error}
      </Alert>
    );
  } else if (empty) {
    body = (
      <EmptyState
        icon={<AppIcon icon={ChartLine} size="lg" />}
        title={emptyText ?? t.charts.empty}
        sx={{ py: 3, minHeight: PLOT_HEIGHT }}
      />
    );
  } else if (asTable) {
    body = (
      <>
        {tableOnlyNotice && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tableOnlyNotice}</Typography>}
        <TableContainer sx={{ maxHeight: 260 }}>
          <Table size="small" stickyHeader aria-label={title}>
            <TableHead>
              <TableRow>
                {table.headers.map((h, i) => <TableCell key={h} align={i === 0 ? 'left' : 'right'}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {table.rows.map((r) => (
                <TableRow key={r.join('|')}>
                  {r.map((c, i) => (
                    <TableCell
                      key={i}
                      align={i === 0 ? 'left' : 'right'}
                      sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </>
    );
  } else {
    body = (
      <Box component="figure" role="group" aria-label={figureAria} sx={{ m: 0 }}>
        <Box aria-hidden>{children}</Box>
      </Box>
    );
  }

  return (
    <Card sx={{ height: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', px: 2.5, pt: 2, pb: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle1" component="h3">{title}</Typography>
            {help && <HelpTip label={title} text={help} />}
          </Stack>
          <Typography variant="caption" color="text.secondary">{unit}</Typography>
        </Box>
        {canToggle && (
          <Tooltip title={showTable ? t.charts.showChart : t.charts.showTable}>
            <ToggleButton
              value="table"
              size="small"
              selected={showTable}
              onChange={() => setShowTable((v) => !v)}
              aria-label={showTable ? t.charts.showChart : t.charts.showTable}
              sx={{ minWidth: 40, minHeight: { xs: 44, sm: 36 } }}
            >
              <AppIcon icon={showTable ? ChartLine : Table2} size="sm" />
            </ToggleButton>
          </Tooltip>
        )}
      </Stack>
      <Divider />
      <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 2 }}>
        {body}
        {note && !loading && !error && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>{note}</Typography>
        )}
      </Box>
    </Card>
  );
}
