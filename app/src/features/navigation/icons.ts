import { Crosshair, ImagePlus, Radar, Repeat2, Store, UsersRound } from 'lucide-react';

/** Ícones dos módulos do roadmap (docs/produto-roadmap.md): mesmos no menu e nas páginas. */
export const MODULE_ICONS = {
  monitoring: Radar,
  mirroring: Repeat2,
  members: UsersRound,
  storefront: Store,
  offerStory: ImagePlus,
  offerHunter: Crosshair,
} as const;
