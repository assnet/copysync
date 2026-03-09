import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  Alert,
} from '@mui/material';
import { sessionService } from '@/services/session.service';
import type { SessionItem } from '@/types/api.types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (session: SessionItem) => void;
}

export function CreateSessionDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const session = await sessionService.create({ name: name.trim() });
      onCreated(session);
      setName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar sessão');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setName('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Nova sessão</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            label="Nome da sessão"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            required
            placeholder="ex: WhatsApp Atendimento"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="contained" disabled={loading || !name.trim()}>
            {loading ? <CircularProgress size={18} color="inherit" /> : 'Criar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
