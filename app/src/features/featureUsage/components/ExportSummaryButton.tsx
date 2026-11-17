import { Box, Button, Tooltip } from '@mui/material';
import { Download } from 'lucide-react';
import { AppIcon } from '@/components';
import { downloadBlob } from '@/features/saver/components/export/downloadFile';
import { featureUsageStrings as S } from '../strings';
import { summaryCsvFileName, summaryToCsv } from '../rules';
import type { UsageSort, UsageSummary } from '../types';

interface ExportSummaryButtonProps {
  /** Resumo carregado com os filtros atuais (`null` enquanto não há resposta). */
  summary: UsageSummary | null;
  loading: boolean;
  sort: UsageSort;
}

/** Exporta o resumo da tela em CSV, gerado no painel a partir da resposta já carregada (sem rota nem nome de conta). */
export function ExportSummaryButton({ summary, loading, sort }: ExportSummaryButtonProps) {
  const disabled = loading || summary === null || summary.features.length === 0;

  const exportCsv = () => {
    if (!summary) return;
    const blob = new Blob([summaryToCsv(summary, sort)], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, summaryCsvFileName(summary.range));
  };

  return (
    <Tooltip title={disabled ? S.csv.disabledHint : S.csv.hint}>
      {/* span: Tooltip precisa de filho que receba eventos mesmo com o botão desabilitado */}
      <Box component="span" sx={{ display: 'inline-flex' }}>
        <Button
          variant="outlined"
          size="small"
          disabled={disabled}
          onClick={exportCsv}
          startIcon={<AppIcon icon={Download} size="sm" />}
          sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
        >
          {S.csv.button}
        </Button>
      </Box>
    </Tooltip>
  );
}
