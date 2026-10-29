import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, IconButton, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { linkDomainsAdminStrings } from '../strings';

const t = linkDomainsAdminStrings.dns;

/** Passo a passo de DNS para um domínio novo (design.md §7), recolhível; aberto/fechado persiste na aba. */
export function DnsSetupGuide() {
  const [expanded, setExpanded] = usePersistedState('linkDomainsAdmin.dnsGuideOpen', false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied((c) => (c === value ? null : c)), 1500);
    } catch {
      // área de transferência bloqueada: o valor continua visível para copiar à mão
    }
  };

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, v) => setExpanded(v)}
      disableGutters
      variant="outlined"
      sx={{ borderRadius: 2, '&:before': { display: 'none' }, mt: 3 }}
    >
      <AccordionSummary
        expandIcon={<AppIcon icon={ChevronDown} size="sm" />}
        aria-controls="dns-guide-content"
        id="dns-guide-header"
        aria-label={t.toggle}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t.title}</Typography>
          <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails id="dns-guide-content">
        <Box component="ol" sx={{ pl: 2.5, m: 0, '& li': { mb: 1 } }}>
          {t.steps.map((step) => (
            <Typography component="li" variant="body2" key={step}>{step}</Typography>
          ))}
        </Box>
        <TableContainer sx={{ mt: 2, border: 1, borderColor: 'divider', borderRadius: 1.5, overflowX: 'auto' }}>
          <Table size="small" aria-label={t.tableCaption}>
            <TableHead>
              <TableRow>
                <TableCell>{t.tableType}</TableCell>
                <TableCell>{t.tableName}</TableCell>
                <TableCell>{t.tableContent}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {t.records.map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.type}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{r.name}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {r.content}
                    <Tooltip title={copied === r.content ? t.copied : t.copy}>
                      <IconButton size="small" sx={{ ml: 0.5 }} aria-label={`${t.copy} ${r.content}`} onClick={() => void copy(r.content)}>
                        <AppIcon icon={copied === r.content ? Check : Copy} size="sm" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{t.notes}</Typography>
      </AccordionDetails>
    </Accordion>
  );
}
