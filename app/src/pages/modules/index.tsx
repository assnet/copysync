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
