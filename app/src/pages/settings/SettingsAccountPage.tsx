import { useNavigate } from 'react-router-dom';
import { Box, TextField, Button } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, SectionCard } from '@/components';
import { settingsStrings } from '@/features/settings/strings';

const t = settingsStrings.account;

export function SettingsAccountPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <Box>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
      />

      <SectionCard title={t.personalData} sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
          <TextField
            label={t.nameLabel}
            value={user?.name ?? ''}
            fullWidth
            InputProps={{ readOnly: true }}
          />
          <TextField
            label={t.emailLabel}
            value={user?.email ?? ''}
            fullWidth
            InputProps={{ readOnly: true }}
          />
        </Box>
      </SectionCard>

      <SectionCard title={t.security} subtitle={t.securitySubtitle}>
        <Button
          variant="outlined"
          startIcon={<LockOutlinedIcon />}
          onClick={() => navigate('/settings/account/password')}
        >
          {t.changePassword}
        </Button>
      </SectionCard>
    </Box>
  );
}
