import { useEffect, useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { sessionService } from '@/services/session.service';
import { sessionStrings } from '../strings';
import { normalizeInternationalPhone, formatInternationalPhone, isValidSessionName, TELEGRAM_QR_TTL_MS } from '../utils';
import { useSessionConnection } from '../hooks/useSessionConnection';
import { useTelegramLogin, telegramErrorMessage } from '../hooks/useTelegramLogin';
import { useSessionWizardState } from '../hooks/useSessionWizardState';
import { SessionWizardDialog } from './SessionWizardDialog';
import { SessionPhoneForm, SessionNameForm } from './SessionWizardFields';
import { TelegramConnectPanel } from './TelegramConnectPanel';
import { SessionConnectedPanel } from './SessionConnectedPanel';
import type { CreateSessionWizardProps } from './CreateSessionWizard';

const t = sessionStrings.wizard;
const tg = sessionStrings.telegram;

type ApiError = Error & { code?: string; field?: string; meta?: { limit?: number } };

/**
 * Assistente Telegram em 4 passos: telefone → nome → conectar (código por padrão, QR opcional) → pronto.
 * Não chama `/connect` ao criar: isso iniciaria o login por QR; o código é pedido no passo 3.
 */
export function CreateTelegramSessionWizard({ open, onClose, onCreated, onStatusChange, onPlanLimit }: CreateSessionWizardProps) {
  const { state, patch, clear } = useSessionWizardState('telegram');
  const { step, phoneInput, name, sessionId } = state;
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const conn = useSessionConnection({
    sessionId, enabled: open && step >= 2, onStatusChange, qrTtlMs: TELEGRAM_QR_TTL_MS, initialMode: 'code',
  });
  const login = useTelegramLogin(open && step >= 2 ? sessionId : null, conn);
  const normalized = normalizeInternationalPhone(phoneInput);
  const nameOk = isValidSessionName(name);

  useEffect(() => {
    if (conn.isConnected && step === 2) patch({ step: 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.isConnected, step]);

  function goToName() {
    setPhoneTouched(true);
    if (normalized) { setPhoneError(null); patch({ step: 1 }); }
  }

  async function create() {
    setNameTouched(true);
    if (!nameOk || !normalized || creating) return;
    setCreating(true); setCreateError(null);
    try {
      const created = await sessionService.create({ name: name.trim(), engine: 'telegram', declaredPhone: normalized });
      onCreated(created);
      patch({ sessionId: created.id, step: 2 });
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'PLAN_LIMIT_REACHED') {
        onPlanLimit?.(Number(e.meta?.limit ?? 0));
        setCreateError(t.limitReached);
      } else if (e.code === 'SESSION_PHONE_INVALID' || e.code === 'TELEGRAM_PHONE_INVALID' || e.field === 'declaredPhone') {
        setPhoneError(tg.phone.rejected);
        patch({ step: 0 });
      } else {
        setCreateError(telegramErrorMessage(e.code) ?? e.message ?? t.createError);
      }
    } finally {
      setCreating(false);
    }
  }

  const handleClose = () => {
    if (creating) return;
    clear();
    setPhoneTouched(false); setPhoneError(null); setNameTouched(false); setCreateError(null);
    onClose();
  };

  const phoneInvalid = phoneTouched && !normalized;

  return (
    <SessionWizardDialog
      open={open}
      onClose={handleClose}
      title={tg.title}
      steps={tg.steps}
      step={step}
      closeDisabled={creating}
      actions={
        <>
          {step === 0 && (
            <>
              <Button onClick={handleClose}>{t.cancel}</Button>
              <Button type="submit" form="telegram-phone-form" variant="contained">{t.next}</Button>
            </>
          )}
          {step === 1 && (
            <>
              <Button onClick={() => patch({ step: 0 })} disabled={creating}>{t.back}</Button>
              <Button
                type="submit"
                form="telegram-name-form"
                variant="contained"
                disabled={creating}
                startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {tg.name.submit}
              </Button>
            </>
          )}
          {step === 2 && <Button onClick={handleClose}>{t.close}</Button>}
          {step === 3 && <Button variant="contained" onClick={handleClose}>{t.finish}</Button>}
        </>
      }
    >
      {step === 0 && (
        <SessionPhoneForm
          formId="telegram-phone-form"
          title={tg.phone.title}
          label={tg.phone.label}
          placeholder={tg.phone.placeholder}
          howTo={{ title: tg.phone.howToTitle, body: tg.phone.howToBody, format: tg.phone.howToFormat }}
          value={phoneInput}
          onChange={(v) => { patch({ phoneInput: v }); setPhoneError(null); }}
          onBlur={() => setPhoneTouched(true)}
          onSubmit={goToName}
          autoComplete="tel"
          error={phoneInvalid || Boolean(phoneError)}
          helperText={
            phoneError ?? (phoneInvalid ? tg.phone.invalid
              : normalized ? tg.phone.preview(formatInternationalPhone(normalized)) : ' ')
          }
        />
      )}
      {step === 1 && (
        <SessionNameForm
          formId="telegram-name-form"
          title={tg.name.title}
          placeholder={tg.name.placeholder}
          helper={tg.name.helper}
          value={name}
          onChange={(v) => patch({ name: v })}
          onBlur={() => setNameTouched(true)}
          onSubmit={() => void create()}
          invalid={nameTouched && !nameOk}
          disabled={creating}
          createError={createError}
        />
      )}
      {step === 2 && <TelegramConnectPanel conn={conn} login={login} phone={normalized} />}
      {step === 3 && <SessionConnectedPanel session={conn.session} channel="telegram" />}
    </SessionWizardDialog>
  );
}
