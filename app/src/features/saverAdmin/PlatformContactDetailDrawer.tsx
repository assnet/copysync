import { ShieldCheck, Users, X } from 'lucide-react';
import {
  Alert, Box, Button, Chip, Divider, Drawer, IconButton, List, ListItem, Skeleton, Stack, Tooltip, Typography,
} from '@mui/material';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { useSaverResource } from '@/features/saver/hooks/useSaverResource';
import { saverAdminService } from '@/services/saverAdmin.service';
import { formatDateTime } from './format';
import { saverAdminStrings as s } from './strings';
import type { PlatformContact } from './types';

interface Props {
  /** Id do contato aberto (persistido pela página); null = fechado. */
  contactId: string | null;
  /** Linha da lista, quando já carregada (cabeçalho com nome e número). */
  contact: PlatformContact | null;
  onClose: () => void;
}

/** Extrações do contato: conta, grupo, data e hora. Recarregado pelo id (nunca salvo). */
export function PlatformContactDetailDrawer({ contactId, contact, onClose }: Props) {
  const blurName = useBlur('saverAdmin.contactNames');
  const blurPhone = useBlur('saverAdmin.contactPhones');
  const blurTenant = useBlur('saverAdmin.tenantNames');
  const detail = useSaverResource(contactId, () => saverAdminService.getContact(contactId!));

  const links = detail.data?.links ?? [];
  return (
    <Drawer anchor="right" open={contactId !== null} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 460 } } }}>
      <Box role="region" aria-label={s.detail.title} sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, minHeight: '100%' }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">{s.detail.title}</Typography>
            {contact && (
              <>
                <Blurred when={blurName}>
                  <Typography variant="h6" noWrap>{contact.name ?? s.table.noName}</Typography>
                </Blurred>
                <Blurred when={blurPhone}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}>
                    {[contact.phone ?? s.table.hiddenPhone, contact.lid].filter(Boolean).join(' · ')}
                  </Typography>
                </Blurred>
              </>
            )}
          </Box>
          <Tooltip title={s.detail.close} arrow>
            <IconButton onClick={onClose} aria-label={s.detail.close}><AppIcon icon={X} size="sm" /></IconButton>
          </Tooltip>
        </Stack>
        <Divider />

        {detail.loading && <Stack gap={1.5}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={72} />)}</Stack>}

        {!detail.loading && detail.error && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void detail.reload()}>{s.error.retry}</Button>}>
            {detail.error.message}
          </Alert>
        )}

        {!detail.loading && !detail.error && detail.data && (
          links.length === 0 ? (
            <Typography color="text.secondary">{s.detail.empty}</Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">{s.detail.count(links.length)}</Typography>
              <List disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {links.map((l) => (
                  <ListItem
                    key={`${l.tenantId}:${l.groupId}`}
                    data-testid="platform-contact-link"
                    sx={{ display: 'block', border: 1, borderColor: 'divider', borderRadius: 2, px: 2, py: 1.5, bgcolor: 'background.paper' }}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                      <Blurred when={blurTenant} inline>
                        <Typography component="span" variant="subtitle2">
                          {l.tenantName || s.detail.unknownTenant(l.tenantId)}
                        </Typography>
                      </Blurred>
                      {l.isAdmin && (
                        <Tooltip title={s.detail.adminHint} arrow>
                          <Chip size="small" variant="outlined" color="primary" label={s.detail.admin} icon={<AppIcon icon={ShieldCheck} size="inline" />} />
                        </Tooltip>
                      )}
                    </Stack>
                    <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: 0.5, color: 'text.secondary', minWidth: 0 }}>
                      <AppIcon icon={Users} size="inline" aria-hidden />
                      <Typography variant="body2" noWrap title={l.groupName}>
                        <Box component="span" sx={visuallyHidden}>{s.detail.group}: </Box>{l.groupName}
                      </Typography>
                    </Stack>
                    <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.25, m: 0, mt: 1 }}>
                      <Typography component="dt" variant="caption" color="text.secondary">{s.detail.first}</Typography>
                      <Typography component="dd" variant="caption" sx={{ m: 0 }}>{formatDateTime(l.firstExtractedAt) ?? s.table.none}</Typography>
                      <Typography component="dt" variant="caption" color="text.secondary">{s.detail.last}</Typography>
                      <Typography component="dd" variant="caption" sx={{ m: 0 }}>{formatDateTime(l.lastExtractedAt) ?? s.table.none}</Typography>
                    </Box>
                    {l.leftAt && (
                      <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                        {s.detail.left(formatDateTime(l.leftAt) ?? s.table.none)}
                      </Typography>
                    )}
                  </ListItem>
                ))}
              </List>
            </>
          )
        )}
      </Box>
    </Drawer>
  );
}

const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;
