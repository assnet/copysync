import { useCallback, useState } from 'react';
import { affiliateCredentialService } from '@/services/affiliateCredential.service';
import type { AcceptMarketplaceRiskResponse } from '@/types/api.types';
import { offerHunterStrings } from '../strings';
import { huntErrorCode } from './useHuntResource';

/**
 * Aceite do aviso de risco do caçador (escopo `OFFER_HUNTER`, versão espelhada em `strings.ts`).
 * Só admin do tenant (403 para os demais). 409 `MARKETPLACE_RISK_NOTICE_OUTDATED` → `stale` (recarregar
 * a página). Depois do aceite, recarregar `useHuntOptions` (portão `riskAccepted`).
 */
export function useHunterRiskAcceptance() {
  const [accepting, setAccepting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const accept = useCallback(async (): Promise<AcceptMarketplaceRiskResponse | null> => {
    const n = offerHunterStrings.riskNotice;
    setAccepting(true);
    setErrorCode(null);
    try {
      return await affiliateCredentialService.acceptRisk('SHEIN', { noticeVersion: n.version, locale: n.locale, scope: n.scope });
    } catch (err) {
      setErrorCode(huntErrorCode(err) ?? 'UNKNOWN');
      return null;
    } finally {
      setAccepting(false);
    }
  }, []);

  return { accept, accepting, errorCode, stale: errorCode === 'MARKETPLACE_RISK_NOTICE_OUTDATED' };
}
