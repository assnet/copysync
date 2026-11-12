import { useState } from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Package } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { offerHunterStrings as t } from '../strings';

/** Foto do produto (borrável por `offerHunter.productImages`); sem foto ou erro de carga = ícone neutro. */
export function ProductThumb({ src, size = 56 }: { src: string | null | undefined; size?: number }) {
  const theme = useTheme();
  const blur = useBlur('offerHunter.productImages');
  const [failed, setFailed] = useState(false);
  const show = Boolean(src) && !failed;
  return (
    <Box
      sx={{
        width: size, height: size, flexShrink: 0, borderRadius: 1.5, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.1 : 0.05),
        color: 'text.disabled',
      }}
    >
      {show ? (
        <Blurred when={blur} radius={10} sx={{ width: '100%', height: '100%' }}>
          <Box
            component="img"
            src={src!}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </Blurred>
      ) : (
        <AppIcon icon={Package} size="md" label={t.ranking.noImage} />
      )}
    </Box>
  );
}
