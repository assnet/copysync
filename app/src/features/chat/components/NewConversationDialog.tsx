import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button,
  Box, Typography, MenuItem, Alert, Avatar, ListItemButton, CircularProgress,
} from '@mui/material';
import { chatService } from '@/services/chat.service';
import type { ContactSuggestionApiDto } from '@/types/chat.api.types';
import { formatPhone } from '../utils';

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: Array<{ id: string; name: string; phone: string | null }>;
  /** Sessão pré-selecionada — a que já está filtrando a lista, quando houver. */
  defaultSessionId?: string | null;
  onCreated: (conversationId: string) => void;
}

/** Mantém só dígitos: o usuário costuma colar com +, espaços e traços. */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function NewConversationDialog({ open, onClose, sessions, defaultSessionId, onCreated }: Props) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [sessionId, setSessionId] = useState(defaultSessionId ?? sessions[0]?.id ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ContactSuggestionApiDto[]>([]);
  const [searching, setSearching] = useState(false);

  // As sessões chegam por requisição, depois da primeira renderização: sem isso o
  // estado inicial fica vazio e o botão nunca habilita.
  useEffect(() => {
    if (!open) return;
    setSessionId((current) => {
      const stillValid = sessions.some((s) => s.id === current);
      if (stillValid) return current;
      return defaultSessionId ?? sessions[0]?.id ?? '';
    });
  }, [open, sessions, defaultSessionId]);

  // Sugestões enquanto digita: contatos conhecidos e, para número completo ainda
  // desconhecido, a verificação no WhatsApp feita pelo servidor.
  useEffect(() => {
    const term = phone.trim();
    if (!open || term.length < 3) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      chatService
        .suggestContacts(term, sessionId || undefined)
        .then((items) => { if (!cancelled) setSuggestions(items); })
        .catch(() => { if (!cancelled) setSuggestions([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [phone, sessionId, open]);

  const digits = onlyDigits(phone);
  // 10 dígitos cobrem fixo com DDD; 14 é o teto de E.164 usado no resto do painel.
  const phoneValid = digits.length >= 10 && digits.length <= 14;
  const canSubmit = phoneValid && !!sessionId && !saving;

  const handleClose = () => {
    if (saving) return;
    setPhone('');
    setName('');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const conversationId = await chatService.startConversation({
        sessionId,
        phone: digits,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setPhone('');
      setName('');
      onCreated(conversationId);
      onClose();
    } catch {
      setError('Não foi possível abrir a conversa. Verifique o número e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Nova conversa</DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Número com DDI e DDD"
            placeholder="55 47 99999-0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void handleSubmit(); }}
            autoFocus
            fullWidth
            size="small"
            type="tel"
            inputProps={{ inputMode: 'tel', autoComplete: 'tel' }}
            helperText={
              phone && !phoneValid
                ? 'Informe o número com DDI e DDD, apenas dígitos.'
                : 'Ex.: 5547999990000'
            }
            error={Boolean(phone) && !phoneValid}
          />

          {(searching || suggestions.length > 0) && (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                maxHeight: 220,
                overflowY: 'auto',
              }}
              aria-live="polite"
            >
              {searching && suggestions.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={18} />
                </Box>
              ) : (
                suggestions.map((s) => (
                  <ListItemButton
                    key={s.phone}
                    onClick={() => {
                      setPhone(s.phone);
                      if (!name && s.known) setName(s.name);
                      setSuggestions([]);
                    }}
                    sx={{ gap: 1.5, py: 1, flexGrow: 0 }}
                  >
                    <Avatar src={s.avatarUrl ?? undefined} sx={{ width: 32, height: 32, fontSize: 12 }}>
                      {/^[\d\s+()-]+$/.test(s.name) ? undefined : s.name[0]?.toUpperCase()}
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" noWrap>{s.name}</Typography>
                      <Typography variant="caption" color="text.disabled" noWrap>
                        {s.known ? formatPhone(s.phone) : 'Não está nos seus contatos'}
                      </Typography>
                    </Box>
                    {s.onWhatsApp === false && (
                      <Typography variant="caption" color="error.main">sem WhatsApp</Typography>
                    )}
                  </ListItemButton>
                ))
              )}
            </Box>
          )}

          <TextField
            label="Nome (opcional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void handleSubmit(); }}
            fullWidth
            size="small"
            inputProps={{ autoComplete: 'name' }}
          />

          {sessions.length > 1 ? (
            <TextField
              select
              label="Enviar pela sessão"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              fullWidth
              size="small"
            >
              {sessions.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}{s.phone ? ` · ${s.phone}` : ''}
                </MenuItem>
              ))}
            </TextField>
          ) : sessions.length === 1 ? (
            <Typography variant="caption" color="text.secondary">
              Pela sessão {sessions[0].name}
              {sessions[0].phone ? ` · ${sessions[0].phone}` : ''}
            </Typography>
          ) : (
            <Alert severity="warning">
              Nenhuma sessão conectada. Conecte um número em Sessões para iniciar conversas.
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>Cancelar</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
          {saving ? 'Abrindo…' : 'Abrir conversa'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
