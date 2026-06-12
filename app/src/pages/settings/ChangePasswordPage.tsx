import { Link as RouterLink } from 'react-router-dom';
import { Box, Breadcrumbs, Link, Typography } from '@mui/material';
import { PageHeader, SectionCard } from '@/components';
import { ChangePasswordForm } from '@/features/settings/components/ChangePasswordForm';

export function ChangePasswordPage() {
  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/settings/account" underline="hover" color="inherit">
          Minha conta
        </Link>
        <Typography color="text.primary">Alterar senha</Typography>
      </Breadcrumbs>

      <PageHeader
        title="Alterar senha"
        subtitle="Defina uma nova senha para sua conta"
      />

      <SectionCard title="Nova senha">
        <ChangePasswordForm />
      </SectionCard>
    </Box>
  );
}
