import { Link as RouterLink } from 'react-router-dom';
import { Box, Breadcrumbs, Link, Typography } from '@mui/material';
import { PageHeader, SectionCard } from '@/components';
import { ChangePasswordForm } from '@/features/settings/components/ChangePasswordForm';
import { settingsStrings } from '@/features/settings/strings';

const t = settingsStrings.password;

export function ChangePasswordPage() {
  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/settings/account" underline="hover" color="inherit">
          {t.breadcrumbAccount}
        </Link>
        <Typography color="text.primary">{t.title}</Typography>
      </Breadcrumbs>

      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
      />

      <SectionCard title={t.cardTitle}>
        <ChangePasswordForm />
      </SectionCard>
    </Box>
  );
}
