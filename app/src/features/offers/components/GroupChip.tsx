import { Avatar, Chip, type ChipProps } from '@mui/material';
import { Users } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur, type PrivacyFlag } from '@/features/privacy';

/** Iniciais das duas primeiras palavras que começam com letra ou número (emoji no início é pulado). */
export function groupInitials(title: string | null | undefined): string {
  const words = (title ?? '').trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return words.slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join('');
}

interface GroupAvatarProps {
  title: string | null;
  avatarUrl: string | null;
  size?: number;
  /** Flag de privacidade da foto; padrão a do gerador de ofertas. */
  blurFlag?: PrivacyFlag;
}

/** Foto do grupo; sem foto, iniciais do nome; sem nome, ícone de grupo. Decorativo (o nome vem ao lado). */
export function GroupAvatar({ title, avatarUrl, size, blurFlag = 'offers.groupAvatars' }: GroupAvatarProps) {
  const initials = groupInitials(title);
  const blurred = useBlur(blurFlag);
  return (
    <Avatar
      src={avatarUrl ?? undefined}
      alt=""
      sx={{
        ...(size && { width: size, height: size, fontSize: Math.round(size * 0.38) }),
        fontWeight: 700,
        bgcolor: 'action.selected',
        color: 'text.secondary',
        ...(blurred && { filter: 'blur(5px)', userSelect: 'none' }),
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
  /** Flags de privacidade da tela que mostra o chip; padrão as do gerador de ofertas. */
  nameFlag?: PrivacyFlag;
  avatarFlag?: PrivacyFlag;
}

/** Chip de grupo com a foto (ou placeholder) antes do nome. */
export function GroupChip({
  title, avatarUrl, untitled, nameFlag = 'offers.groupNames', avatarFlag = 'offers.groupAvatars', ...chip
}: GroupChipProps) {
  const blurNames = useBlur(nameFlag);
  return (
    <Chip
      size="small"
      avatar={<GroupAvatar title={title} avatarUrl={avatarUrl} size={18} blurFlag={avatarFlag} />}
      label={<Blurred when={blurNames} inline radius={5}>{title || untitled}</Blurred>}
      {...chip}
    />
  );
}
