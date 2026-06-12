import { useNavigate } from 'react-router-dom';
import { Box, TextField, Button } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, SectionCard } from '@/components';

export function SettingsAccountPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <Box>
      <PageHeader
        title="Minha conta"
        subtitle="Visualize seus dados e gerencie a segurança da conta"
      />

      <SectionCard title="Dados pessoais" sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
          <TextField
            label="Nome"
            value={user?.name ?? ''}
            fullWidth
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="E-mail"
            value={user?.email ?? ''}
            fullWidth
            InputProps={{ readOnly: true }}
          />
        </Box>
      </SectionCard>

      <SectionCard title="Segurança" subtitle="Gerencie a senha de acesso ao painel">
        <Button
          variant="outlined"
          startIcon={<LockOutlinedIcon />}
          onClick={() => navigate('/settings/account/password')}
        >
          Alterar senha
        </Button>
      </SectionCard>
    </Box>
  );
}
