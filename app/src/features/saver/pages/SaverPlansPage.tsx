import { Crown } from 'lucide-react';
import { SaverPageSkeleton } from '../components/SaverPageSkeleton';
import { saverStrings as s } from '../strings';

/** Vitrine de planos do Saver (preenchida em T26). */
export function SaverPlansPage() {
  return <SaverPageSkeleton title={s.menu.plans} subtitle={s.pages.comingSoon} icon={Crown} />;
}
