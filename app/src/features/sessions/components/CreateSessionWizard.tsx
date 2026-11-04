import { useEffect, useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { sessionService } from '@/services/session.service';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { normalizeBrazilPhone, formatBrazilPhone, isValidSessionName } from '../utils';
import { useSessionConnection } from '../hooks/useSessionConnection';
import { useSessionWizardState } from '../hooks/useSessionWizardState';
import { SessionWizardDialog } from './SessionWizardDialog';
import { SessionPhoneForm, SessionNameForm } from './SessionWizardFields';
import { SessionConnectPanel } from './SessionConnectPanel';
import { SessionConnectedPanel } from './SessionConnectedPanel';

const t = sessionStrings.wizard;

export interface CreateSessionWizardProps {
  open: boolean;
  onClose: () => void;
  /** Sessão criada (o assistente continua aberto para conectar). */
  onCreated: (session: SessionItem) => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
  /** `POST /sessions` recusou por limite do plano (`PLAN_LIMIT_REACHED`). */
  onPlanLimit?: (limit: number) => void;
}

type ApiError = Error & { code?: string; field?: string; meta?: { limit?: number } };

/** Assistente WhatsApp em 4 passos: número → nome → conectar → pronto. Estado sobrevive a reload. */
export function CreateSessionWizard({ open, onClose, onCreated, onStatusChange, onPlanLimit }: CreateSessionWizardProps) {
  const { state, patch, clear } = useSessionWizardState('whatsapp');
  const { step, phoneInput, name, sessionId } = state;
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const conn = useSessionConnection({ sessionId, enabled: open && step >= 2, onStatusChange });
  const normalized = normalizeBrazilPhone(phoneInput);
  const nameOk = isValidSessionName(name);

  useEffect(() => {
    if (conn.isConnected && step === 2) patch({ step: 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.isConnected, step]);

  function goToName() {
    setPhoneTouched(true);
    if (normalized) { setPhoneError(null); patch({ step: 1 }); }
  }

  async function createAndConnect() {
    setNameTouched(true);
    if (!nameOk || !normalized || creating) return;
    setCreating(true); setCreateError(null);
    let created: SessionItem;
    try {
      created = await sessionService.create({ name: name.trim(), engine: 'baileys', declaredPhone: normalized });
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'PLAN_LIMIT_REACHED') {
        onPlanLimit?.(Number(e.meta?.limit ?? 0));
        setCreateError(t.limitReached);
      } else if (e.code === 'SESSION_PHONE_INVALID' || e.field === 'declaredPhone') {
        setPhoneError(t.phone.rejected);
        patch({ step: 0 });
      } else {
        setCreateError(e.message || t.createError);
      }
      setCreating(false);
      return;
    }
    onCreated(created);
    patch({ sessionId: created.id, step: 2 });
    try {
      const res = await sessionService.connect(created.id);
      onStatusChange?.(created.id, res.status);
    } catch {
      // A sessão existe; o passo 3 mostra "Gerar novo código" para tentar de novo.
    }
    setCreating(false);
  }

  // Fechar em qualquer passo conclui/cancela o fluxo: rascunho não volta na próxima abertura.
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
      title={t.title}
      steps={t.steps}
      step={step}
      closeDisabled={creating}
      actions={
        <>
          {step === 0 && (
            <>
              <Button onClick={handleClose}>{t.cancel}</Button>
              <Button type="submit" form="session-phone-form" variant="contained">{t.next}</Button>
            </>
          )}
          {step === 1 && (
            <>
              <Button onClick={() => patch({ step: 0 })} disabled={creating}>{t.back}</Button>
              <Button
                type="submit"
                form="session-name-form"
                variant="contained"
                disabled={creating}
                startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {t.name.submit}
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
          formId="session-phone-form"
          title={t.phone.title}
          label={t.phone.label}
          placeholder={t.phone.placeholder}
          howTo={{ title: t.phone.howToTitle, body: t.phone.howToBody, format: t.phone.howToFormat }}
          value={phoneInput}
          onChange={(v) => { patch({ phoneInput: v }); setPhoneError(null); }}
          onBlur={() => setPhoneTouched(true)}
          onSubmit={goToName}
          autoComplete="tel-national"
          error={phoneInvalid || Boolean(phoneError)}
          helperText={
            phoneError ?? (phoneInvalid ? t.phone.invalid
              : normalized ? t.phone.preview(formatBrazilPhone(normalized)) : ' ')
          }
        />
      )}
      {step === 1 && (
        <SessionNameForm
          formId="session-name-form"
          title={t.name.title}
          placeholder={t.name.placeholder}
          helper={t.name.helper}
          value={name}
          onChange={(v) => patch({ name: v })}
          onBlur={() => setNameTouched(true)}
          onSubmit={() => void createAndConnect()}
          invalid={nameTouched && !nameOk}
          disabled={creating}
          createError={createError}
        />
      )}
      {step === 2 && <SessionConnectPanel conn={conn} />}
      {step === 3 && <SessionConnectedPanel session={conn.session} />}
    </SessionWizardDialog>
  );
}
