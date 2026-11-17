import { Avatar } from '@mui/material';
import { UsersRound } from 'lucide-react';
import { AppIcon } from '@/components';
import { useBlur } from '@/features/privacy';
import { groupAvatarInitials } from '../../groupList';

/** Avatar de iniciais do grupo. Com o borrão de nomes ligado vira ícone neutro: nenhuma letra do nome no DOM. */
export function SaverGroupAvatar({ name, size }: { name: string; size: number }) {
  const blur = useBlur('saver.groupNames');
  const initials = blur ? '' : groupAvatarInitials(name);
  return (
    <Avatar
      aria-hidden
      sx={{ width: size, height: size, fontSize: Math.round(size * (initials.length > 2 ? 0.32 : 0.38)), fontWeight: 700, bgcolor: 'action.selected', color: 'text.secondary' }}
    >
      {initials || <AppIcon icon={UsersRound} size="sm" />}
    </Avatar>
  );
}
