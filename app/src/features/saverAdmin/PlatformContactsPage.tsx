import { Contact } from 'lucide-react';
import { SaverPageSkeleton } from '@/features/saver/components/SaverPageSkeleton';
import { saverStrings as s } from '@/features/saver/strings';

/** Super admin: base de contatos da plataforma (preenchida em T23). */
export function PlatformContactsPage() {
  return <SaverPageSkeleton title={s.pages.platformContacts.title} subtitle={s.pages.platformContacts.subtitle} icon={Contact} />;
}
