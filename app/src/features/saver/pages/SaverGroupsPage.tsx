import { UsersRound } from 'lucide-react';
import { SaverPageSkeleton } from '../components/SaverPageSkeleton';
import { saverStrings as s } from '../strings';

/** Grupos do Saver: escolher sessão, marcar grupos e salvar contatos (preenchida em T22). */
export function SaverGroupsPage() {
  return <SaverPageSkeleton title={s.pages.groups.title} subtitle={s.pages.groups.subtitle} icon={UsersRound} />;
}
