import { useState } from 'react';
import {
  Box, TextField, Button, Alert, CircularProgress,
  InputAdornment, IconButton, Typography, List, ListItem, ListItemIcon, ListItemText,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { accountService } from '@/services/account.service';
import {
  getUnmetRequirements,
  passwordsMatch,
  PASSWORD_REQUIREMENTS,
} from '../utils/passwordPolicy';
import { settingsStrings } from '../strings';

const t = settingsStrings.password;

interface Props {
  onSuccess?: () => void;
}

export function ChangePasswordForm({ onSuccess }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const unmetRequirements = newPassword ? getUnmetRequirements(newPassword) : [...PASSWORD_REQUIREMENTS];
  const mismatch = confirmPassword.length > 0 && !passwordsMatch(newPassword, confirmPassword);

  const canSubmit =
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    unmetRequirements.length === 0 &&
    passwordsMatch(newPassword, confirmPassword) &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (unmetRequirements.length > 0) {
      setError(unmetRequirements.join('. '));
      return;
    }

    if (!passwordsMatch(newPassword, confirmPassword)) {
      setError(t.mismatch);
      return;
    }

    setLoading(true);
    try {
      await accountService.changePassword({ newPassword, confirmPassword });
      setSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.genericError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {t.success}
        </Alert>
      )}

      <TextField
        label={t.newPasswordLabel}
        type={showNewPassword ? 'text' : 'password'}
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        fullWidth
        required
        autoComplete="new-password"
        sx={{ mb: 2 }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setShowNewPassword((v) => !v)}
                edge="end"
                size="small"
                aria-label={showNewPassword ? t.hidePassword : t.showPassword}
              >
                {showNewPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />

      <TextField
        label={t.confirmPasswordLabel}
        type={showConfirmPassword ? 'text' : 'password'}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        fullWidth
        required
        autoComplete="new-password"
        error={mismatch}
        helperText={mismatch ? t.mismatch : undefined}
        sx={{ mb: 2 }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setShowConfirmPassword((v) => !v)}
                edge="end"
                size="small"
                aria-label={showConfirmPassword ? t.hidePassword : t.showPassword}
              >
                {showConfirmPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />

      {newPassword.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>
            {t.requirementsTitle}
          </Typography>
          <List dense disablePadding>
            {PASSWORD_REQUIREMENTS.map((req) => {
              const met = !unmetRequirements.includes(req);
              return (
                <ListItem key={req} disablePadding sx={{ py: 0.25 }}>
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    {met ? (
                      <CheckCircleOutlineIcon fontSize="small" color="success" />
                    ) : (
                      <RadioButtonUncheckedIcon fontSize="small" color="disabled" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={req}
                    primaryTypographyProps={{
                      variant: 'caption',
                      color: met ? 'success.main' : 'text.secondary',
                    }}
                  />
                </ListItem>
              );
            })}
          </List>
        </Box>
      )}

      <Button
        type="submit"
        variant="contained"
        disabled={!canSubmit}
        sx={{ minWidth: 160 }}
      >
        {loading ? <CircularProgress size={22} color="inherit" /> : t.submit}
      </Button>
    </Box>
  );
}
