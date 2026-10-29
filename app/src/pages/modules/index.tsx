import { Radar, Repeat2, Store, UsersRound } from 'lucide-react';
import { UpcomingModulePage } from './UpcomingModulePage';

/** Módulos do roadmap (docs/produto-roadmap.md) já com rota e item de menu. Ícones = os do menu. */
export const MODULE_ICONS = {
  monitoring: Radar,
  mirroring: Repeat2,
  members: UsersRound,
  storefront: Store,
} as const;

export function MirroringPage() {
  return (
    <UpcomingModulePage
      icon={MODULE_ICONS.mirroring}
      title="Espelhamento"
      subtitle="O que entra em um grupo sai nos outros"
      description="Tudo o que for postado em um grupo de origem é espelhado nos grupos de destino, com o seu link e na sua ordem."
    />
  );
}

export function MembersPage() {
  return (
    <UpcomingModulePage
      icon={MODULE_ICONS.members}
      title="Gestor de membros"
      subtitle="Participantes dos seus grupos em um só lugar"
      description="Veja quem entra e sai, encontre membros repetidos entre grupos e organize listas para campanhas."
    />
  );
}
