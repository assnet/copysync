import { Box, Link, Paper, Stack, Typography } from '@mui/material';
import { PublicDocumentPage } from '@/components/PublicDocumentPage';
import { SUPPORT_CONTACT, supportStrings as s } from '@/features/support/strings';

function ContactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.25, sm: 2 }}>
      <Typography component="dt" sx={{ minWidth: 88, color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
      <Typography component="dd" sx={{ m: 0 }}>{children}</Typography>
    </Stack>
  );
}

/**
 * Página pública (sem login) de Suporte. É a "URL do suporte" declarada na Chrome Web Store;
 * precisa responder sem autenticação. Texto em `features/support/strings.ts`.
 */
export function SupportPage() {
  return (
    <PublicDocumentPage
      pageTitle={s.pageTitle}
      title={s.title}
      subtitle={s.subtitle}
      intro={s.intro}
      sections={s.sections}
      backToLogin={s.backToLogin}
    >
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 1, mb: 2, borderRadius: 2 }}>
        <Typography component="h2" variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>{s.contactTitle}</Typography>
        <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1 }}>
          <ContactRow label={s.contact.emailLabel}>
            <Link href={`mailto:${SUPPORT_CONTACT.email}`}>{SUPPORT_CONTACT.email}</Link>
          </ContactRow>
          <ContactRow label={s.contact.hoursLabel}>{SUPPORT_CONTACT.hours}</ContactRow>
          <ContactRow label={s.contact.firstReplyLabel}>{SUPPORT_CONTACT.firstReply}</ContactRow>
          <ContactRow label={s.contact.websiteLabel}>
            <Link href={SUPPORT_CONTACT.website} target="_blank" rel="noopener noreferrer">{SUPPORT_CONTACT.website}</Link>
          </ContactRow>
        </Box>
      </Paper>
    </PublicDocumentPage>
  );
}
