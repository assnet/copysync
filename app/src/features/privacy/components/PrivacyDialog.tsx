import { forwardRef, type ReactElement, type Ref } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grow, IconButton, Slide, Stack, Tooltip, Typography,
  useMediaQuery, type SlideProps,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { EyeOff, X } from 'lucide-react';
import { AppIcon, ToggleOption } from '@/components';
import { PRIVACY_SCREENS } from '../privacyFlags';
import { usePrivacy } from '../PrivacyContext';
import { privacyStrings } from '../strings';

const t = privacyStrings.dialog;

const SlideUp = forwardRef(function SlideUp(props: SlideProps & { children: ReactElement }, ref: Ref<unknown>) {
  return <Slide direction="up" ref={ref} {...props} />;
});

/** Diálogo de privacidade: no celular ocupa a tela e sobe de baixo; no desktop cresce do centro. */
export function PrivacyDialog() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { dialogOpen, closeDialog, flags, isBlurred, setFlag, setScreen, setAll } = usePrivacy();
  const allOn = PRIVACY_SCREENS.every((s) => s.flags.every((f) => flags.has(f.id)));

  return (
    <Dialog
      open={dialogOpen}
      onClose={closeDialog}
      fullScreen={mobile}
      fullWidth
      maxWidth="sm"
      TransitionComponent={mobile ? SlideUp : Grow}
      transitionDuration={reduceMotion ? 0 : 240}
      aria-labelledby="privacy-dialog-title"
      slotProps={{ paper: { sx: mobile ? {} : { borderRadius: 3 } } }}
    >
      <DialogTitle id="privacy-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 7 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 2, bgcolor: 'action.selected', color: 'primary.main' }}>
          <AppIcon icon={EyeOff} size="md" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="span" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.2 }}>{t.title}</Typography>
          <Typography variant="caption" color="text.secondary">{t.subtitle}</Typography>
        </Box>
        <Tooltip title={t.close}>
          <IconButton onClick={closeDialog} aria-label={t.close} sx={{ position: 'absolute', right: 12, top: 12 }}>
            <AppIcon icon={X} size="md" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Button
            variant={allOn ? 'outlined' : 'contained'}
            disableElevation
            onClick={() => setAll(!allOn)}
            startIcon={<AppIcon icon={EyeOff} size="sm" />}
            sx={{ alignSelf: 'flex-start' }}
          >
            {allOn ? t.allOff : t.allOn}
          </Button>

          {PRIVACY_SCREENS.map((screen) => {
            const screenOn = screen.flags.every((f) => flags.has(f.id));
            return (
              <Box key={screen.id}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{screen.label}</Typography>
                  <Button size="small" onClick={() => setScreen(screen.id, !screenOn)}>
                    {screenOn ? t.allOff : t.screenAll}
                  </Button>
                </Box>
                <Stack spacing={1}>
                  {screen.flags.map((flag) => (
                    <ToggleOption key={flag.id} checked={isBlurred(flag.id)} onChange={(on) => setFlag(flag.id, on)} title={flag.label} />
                  ))}
                </Stack>
              </Box>
            );
          })}

          <Typography variant="caption" color="text.secondary">{t.note}</Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="contained" disableElevation onClick={closeDialog} fullWidth={mobile}>{t.done}</Button>
      </DialogActions>
    </Dialog>
  );
}
