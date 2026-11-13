import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { serverNow } from '@/services/serverClock';
import { storefrontStrings } from '../strings';
import type { StorefrontApiError } from '../types';

const t = storefrontStrings.deletePage;
/** Com bloqueio ativo, o texto dos minutos restantes é refeito neste intervalo. */
const LOCK_TICK_MS = 30_000;

export interface DeleteStorefrontDialogProps {
  open: boolean;
  /** Endereço público sem o protocolo (ou só o subdomínio); null = sem endereço para mostrar. */
  address: string | null;
  offerCount: number;
  /**
   * Fim do bloqueio por senha errada (ms, relógio do servidor), guardado por quem chama: fechar e
   * reabrir o diálogo não libera o campo. null = sem bloqueio.
   */
  lockedUntil: number | null;
  onClose: () => void;
  /**
   * Exclui com a senha digitada. Resolve quando a página foi excluída (quem chama fecha e recarrega);
   * rejeita com o erro da API (`code`, `meta`) para o diálogo mostrar.
   */
  onConfirm: (password: string) => Promise<void>;
}

/**
 * Confirmação de excluir a Página de Ofertas com a senha de quem está logado.
 * A senha vive só em `useState` deste diálogo: nunca em `usePersistedState`/storage, e é apagada
 * ao fechar, ao concluir e a cada erro.
 */
export function DeleteStorefrontDialog({ open, address, offerCount, lockedUntil, onClose, onConfirm }: DeleteStorefrontDialogProps) {
  const blurAddress = useBlur('storefront.subdomain');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [now, setNow] = useState(serverNow);
  const inputRef = useRef<HTMLInputElement>(null);

  // Abrir ou fechar sempre começa do zero: nada digitado sobrevive ao diálogo. O bloqueio não
  // entra aqui: vem de `lockedUntil` e continua valendo ao reabrir.
  useEffect(() => {
    setPassword('');
    setVisible(false);
    setWrongPassword(false);
    setAlert(null);
  }, [open]);

  const lockMs = lockedUntil ? lockedUntil - now : 0;
  const locked = lockMs > 0;
  useEffect(() => setNow(serverNow()), [open, lockedUntil]);
  // Um timer por vez até o fim do bloqueio (rearmado a cada `now`), limpo ao fechar e ao desmontar.
  useEffect(() => {
    if (!open || lockMs <= 0) return;
    const timer = setTimeout(() => setNow(serverNow()), Math.min(lockMs, LOCK_TICK_MS));
    return () => clearTimeout(timer);
  }, [open, lockMs]);

  // Senha recusada: o foco volta ao campo assim que ele é reabilitado.
  useEffect(() => {
    if (wrongPassword && !sending) inputRef.current?.focus();
  }, [wrongPassword, sending]);

  const canSubmit = password.length > 0 && !sending && !locked;

  const showError = (err: unknown) => {
    const e = (err ?? {}) as StorefrontApiError;
    if (e.code === 'INVALID_CREDENTIALS') return setWrongPassword(true);
    // Bloqueio: quem chama grava o prazo em `lockedUntil`; o aviso sai dele.
    if (e.code === 'PASSWORD_CONFIRMATION_LOCKED') return;
    setAlert(e.code === 'FORBIDDEN' ? t.errors.forbidden : t.errors.generic);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const typed = password;
    setSending(true);
    setWrongPassword(false);
    setAlert(null);
    try {
      await onConfirm(typed);
    } catch (err) {
      showError(err);
    } finally {
      setPassword('');
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="xs" fullWidth aria-labelledby="delete-storefront-title">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogTitle id="delete-storefront-title" sx={{ fontWeight: 700, pb: 1 }}>{t.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="body2" color="text.secondary">{t.intro}</Typography>
              <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, '& li': { typography: 'body2', mb: 0.5 } }}>
                {address && (
                  <li>
                    {t.addressItem}{' '}
                    <Box component="strong" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
                      <Blurred when={blurAddress} inline radius={5}>{address}</Blurred>
                    </Box>
                  </li>
                )}
                <li>{t.offersItem(offerCount)}</li>
                <li>{t.imagesItem}</li>
              </Box>
            </Box>

            <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>{t.addressFreed}</Alert>
            <Typography variant="body2" color="text.secondary">{t.irreversible}</Typography>

            {(locked || alert) && (
              <Alert severity="error" role="alert">{locked ? t.errors.locked(Math.ceil(lockMs / 60_000)) : alert}</Alert>
            )}

            <TextField
              label={t.passwordLabel}
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setWrongPassword(false);
              }}
              error={wrongPassword}
              helperText={wrongPassword ? t.errors.wrongPassword : t.passwordHelp}
              disabled={sending || locked}
              autoComplete="off"
              inputRef={inputRef}
              autoFocus
              fullWidth
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title={visible ? t.hidePassword : t.showPassword} arrow>
                        <IconButton
                          onClick={() => setVisible((v) => !v)} edge="end" size="small"
                          aria-label={visible ? t.hidePassword : t.showPassword}
                        >
                          <AppIcon icon={visible ? EyeOff : Eye} size="sm" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={sending}>{t.cancel}</Button>
          <Button
            type="submit" variant="contained" color="error" disableElevation disabled={!canSubmit}
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Trash2} size="sm" />}
          >
            {sending ? t.deleting : t.confirm}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
