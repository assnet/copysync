/**
 * Registro das flags de privacidade (borrar dados na tela). Toda tela nova que mostre dado
 * sensível (nomes, fotos, números, textos de clientes) entra aqui JÁ NO PLANEJAMENTO, com
 * uma flag por tipo de dado — ver docs/padrao-ui-painel.md ("Privacidade") e AGENTS.md.
 *
 * Id da flag = `<tela>.<dado>`. A tela é a chave de agrupamento no diálogo.
 */
export const PRIVACY_SCREENS = [
  {
    id: 'offers',
    label: 'Gerador de ofertas',
    flags: [
      { id: 'offers.groupAvatars', label: 'Fotos dos grupos' },
      { id: 'offers.groupNames', label: 'Nomes dos grupos' },
      { id: 'offers.productImages', label: 'Imagens dos produtos' },
      { id: 'offers.productText', label: 'Título e texto das ofertas' },
    ],
  },
] as const;

export type PrivacyScreenId = (typeof PRIVACY_SCREENS)[number]['id'];
export type PrivacyFlag = (typeof PRIVACY_SCREENS)[number]['flags'][number]['id'];

export const ALL_PRIVACY_FLAGS: readonly PrivacyFlag[] = PRIVACY_SCREENS.flatMap((s) => s.flags.map((f) => f.id));

export function isPrivacyFlag(value: unknown): value is PrivacyFlag {
  return typeof value === 'string' && (ALL_PRIVACY_FLAGS as readonly string[]).includes(value);
}
