import { useCallback, useEffect, useState } from 'react';
import { linkRotationService } from '@/services/linkRotation.service';
import type { Rotation, RotationOverview } from '../types';

/** Overview do rodízio (dado do servidor: recarregado, nunca persistido). */
export function useLinkRotationOverview() {
  const [overview, setOverview] = useState<RotationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setOverview(await linkRotationService.getOverview());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Substitui (ou acrescenta) um rodízio devolvido pela API, sem recarregar tudo. */
  const upsert = useCallback((rotation: Rotation) => {
    setOverview((prev) => {
      if (!prev) return prev;
      const exists = prev.rotations.some((r) => r.id === rotation.id);
      return {
        ...prev,
        rotations: exists ? prev.rotations.map((r) => (r.id === rotation.id ? rotation : r)) : [...prev.rotations, rotation],
      };
    });
  }, []);

  return { overview, loading, failed, reload: load, upsert };
}
