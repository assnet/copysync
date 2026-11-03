import { MODULE_ICONS } from '@/features/navigation/icons';
import { UpcomingModulePage } from './UpcomingModulePage';

// Ícones vivem em features/navigation/icons.ts (o modelo do menu não importa de pages/).
export { MODULE_ICONS };

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
