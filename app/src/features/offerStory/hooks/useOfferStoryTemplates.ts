import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isPlanFeatureUnavailable } from '@/features/plans/planGate';
import { offerStoryService } from '@/services/offerStory.service';
import { offerStoryUpgradePath } from '../planGate';
import type { OfferStoryTemplate } from '../types';

/** Catálogo de templates (dado do servidor: recarregado, nunca persistido). Sem plano → `/plans`. */
export function useOfferStoryTemplates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<OfferStoryTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setTemplates(await offerStoryService.listTemplates());
    } catch (err) {
      if (isPlanFeatureUnavailable(err)) {
        navigate(offerStoryUpgradePath, { replace: true });
        return;
      }
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  return { templates, loading, failed, reload: load };
}
