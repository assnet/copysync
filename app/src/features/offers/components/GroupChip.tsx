import { Avatar, Chip, type ChipProps } from '@mui/material';
import { Users } from 'lucide-react';
import { AppIcon } from '@/components';

/** Iniciais das duas primeiras palavras que começam com letra ou número (emoji no início é pulado). */
export function groupInitials(title: string | null | undefined): string {
  const words = (title ?? '').trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return words.slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join('');
}

interface GroupAvatarProps {
  title: string | null;
  avatarUrl: string | null;
  size?: number;
}

/** Foto do grupo; sem foto, iniciais do nome; sem nome, ícone de grupo. Decorativo (o nome vem ao lado). */
export function GroupAvatar({ title, avatarUrl, size }: GroupAvatarProps) {
  const initials = groupInitials(title);
  return (
    <Avatar
      src={avatarUrl ?? undefined}
      alt=""
      sx={{
        ...(size && { width: size, height: size, fontSize: Math.round(size * 0.38) }),
        fontWeight: 700,
        bgcolor: 'action.selected',
        color: 'text.secondary',
      }}
    >
      {initials || <AppIcon icon={Users} size="sm" />}
    </Avatar>
  );
}

interface GroupChipProps extends Omit<ChipProps, 'avatar' | 'label' | 'title'> {
  title: string | null;
  avatarUrl: string | null;
  /** Texto para grupo sem nome. */
  untitled: string;
}

/** Chip de grupo com a foto (ou placeholder) antes do nome. */
export function GroupChip({ title, avatarUrl, untitled, ...chip }: GroupChipProps) {
  return <Chip size="small" avatar={<GroupAvatar title={title} avatarUrl={avatarUrl} />} label={title || untitled} {...chip} />;
}
