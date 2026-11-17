import { Settings2 } from 'lucide-react';
import { SaverPageSkeleton } from '../components/SaverPageSkeleton';
import { saverStrings as s } from '../strings';

/** Configurações do Saver e "Quem pode exportar" (preenchida em T25). */
export function SaverSettingsPage() {
  return <SaverPageSkeleton title={s.pages.settings.title} subtitle={s.pages.settings.subtitle} icon={Settings2} />;
}
