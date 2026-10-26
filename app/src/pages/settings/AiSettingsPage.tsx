import { Alert, AlertTitle, Box, Button, CircularProgress } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { PageHeader } from '@/components';
import { TenantAiKeyForm } from '@/features/ai/components/TenantAiKeyForm';
import { useTenantAi } from '@/features/ai/hooks/useTenantAi';
import { aiStrings } from '@/features/ai/strings';

const t = aiStrings.tenant;

/**
 * Configurações → Inteligência artificial.
 * PLATFORM: IA incluída (sem campos). Chave própria permitida e plataforma indisponível (ou já em uso): formulário.
 * Nada disponível: aviso.
 */
export function AiSettingsPage() {
  const ai = useTenantAi();
  const s = ai.status;
  const showForm = s ? s.mode === 'TENANT' || (s.tenantKeysAllowed && !s.platformAvailable) : false;

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} />

      {ai.loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t.pageTitle} />
        </Box>
      ) : ai.loadError || !s ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void ai.reload()}>{t.retry}</Button>}
        >
          {ai.loadError ?? aiStrings.errors.generic}
        </Alert>
      ) : s.mode === 'PLATFORM' ? (
        <Alert severity="success" icon={<AutoAwesomeOutlinedIcon />} variant="outlined">
          <AlertTitle sx={{ fontWeight: 700 }}>{t.includedTitle}</AlertTitle>
          {t.includedBody}
        </Alert>
      ) : showForm ? (
        <TenantAiKeyForm
          credential={s.credential}
          catalog={ai.catalog}
          testing={ai.testing}
          testResult={ai.testResult}
          onSave={ai.save}
          onTest={() => void ai.test()}
          onRemove={ai.remove}
        />
      ) : (
        <Alert severity="info" variant="outlined">
          <AlertTitle sx={{ fontWeight: 700 }}>{t.unavailableTitle}</AlertTitle>
          {t.unavailableBody}
        </Alert>
      )}
    </Box>
  );
}
