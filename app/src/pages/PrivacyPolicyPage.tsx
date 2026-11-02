import { PublicDocumentPage } from '@/components/PublicDocumentPage';
import { privacyPolicyStrings as s } from '@/features/privacy-policy/strings';

/**
 * Página pública (sem login) da Política de Privacidade. É a URL declarada na Chrome Web Store;
 * precisa responder sem autenticação. Texto em `features/privacy-policy/strings.ts`.
 */
export function PrivacyPolicyPage() {
  return (
    <PublicDocumentPage
      pageTitle={s.pageTitle}
      title={s.title}
      subtitle={s.updatedAt}
      intro={s.intro}
      sections={s.sections}
      backToLogin={s.backToLogin}
    />
  );
}
