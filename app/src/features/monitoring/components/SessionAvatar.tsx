import { Avatar } from '@mui/material';
import { Smartphone } from 'lucide-react';

/**
 * Foto da sessão no tamanho do texto ao lado (`size` em px); sem foto, ícone de aparelho.
 * Decorativa (o nome da sessão vai em texto); `blur` = flag `monitoring.sessionAvatar`.
 */
export function SessionAvatar({ url, size, blur }: { url: string | null | undefined; size: number; blur: boolean }) {
  return (
    <Avatar
      src={url ?? undefined}
      alt=""
      aria-hidden
      sx={{
        width: size, height: size, flexShrink: 0, bgcolor: 'action.selected', color: 'text.secondary',
        '& svg': { width: size * 0.7, height: size * 0.7 },
        ...(blur && { filter: 'blur(4px)' }),
      }}
    >
      <Smartphone />
    </Avatar>
  );
}
