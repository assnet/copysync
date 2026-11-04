import type { ReactNode } from 'react';
import { Avatar, Badge, Box, Typography } from '@mui/material';
import { Smartphone } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { channelLabel } from '@/features/sessions/components/SessionChannelChip';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { linkRotationStrings } from '../strings';
import type { RotationSessionOption } from '../types';

/** Texto só para leitor de tela (o logo do canal é decorativo ao lado do nome). */
const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

interface AvatarProps {
  session: RotationSessionOption;
  /** Diâmetro da foto em px. */
  size?: number;
}

/**
 * Foto da sessão com o logo do canal (WhatsApp/Telegram) no canto, como selo. Sem foto: ícone
 * de aparelho. A foto segue a flag `linkRotation.sessionAvatar`; o logo nunca é borrado.
 */
export function RotationSessionAvatar({ session, size = 28 }: AvatarProps) {
  const blurAvatar = useBlur('linkRotation.sessionAvatar');
  const badge = Math.round(size * 0.55);
  return (
    <Badge
      overlap="circular"
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      sx={{ flexShrink: 0 }}
      badgeContent={
        <Box
          component="span"
          sx={{
            width: badge, height: badge, borderRadius: '50%', bgcolor: 'background.paper', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', boxShadow: (th) => `0 0 0 1px ${th.palette.divider}`, fontSize: badge * 0.8,
          }}
        >
          <ChannelLogo channel={session.channel} />
        </Box>
      }
    >
      <Avatar
        src={resolveMediaUrl(session.avatarUrl) ?? undefined}
        alt=""
        sx={{
          width: size, height: size, bgcolor: 'action.selected', color: 'text.secondary',
          ...(blurAvatar && { filter: 'blur(6px)' }),
        }}
      >
        <AppIcon icon={Smartphone} size="sm" />
      </Avatar>
    </Badge>
  );
}

interface IdentityProps {
  /** `null` = sessão removida. */
  session: RotationSessionOption | null;
  size?: number;
  /** Linha de baixo (ex.: situação da conexão). */
  secondary?: ReactNode;
}

/** Foto + logo do canal + nome da sessão (nome segue `linkRotation.sessionName`). */
export function RotationSessionIdentity({ session, size = 28, secondary }: IdentityProps) {
  const blurName = useBlur('linkRotation.sessionName');
  const name = session ? session.name || linkRotationStrings.page.untitledSession : linkRotationStrings.page.sessionRemoved;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
      {session && <RotationSessionAvatar session={session} size={size} />}
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Blurred when={blurName} inline radius={5}>
          <Typography component="span" variant="body2" noWrap sx={{ fontWeight: 600, display: 'block' }}>{name}</Typography>
        </Blurred>
        {session && <Box component="span" sx={SR_ONLY}>{channelLabel(session.channel)}</Box>}
        {secondary}
      </Box>
    </Box>
  );
}
