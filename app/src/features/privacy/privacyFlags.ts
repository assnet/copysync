/**
 * Registro das flags de privacidade (borrar dados na tela). Toda tela nova que mostre dado
 * sensível (nomes, fotos, números, textos de clientes) entra aqui JÁ NO PLANEJAMENTO, com
 * uma flag por tipo de dado — ver docs/padrao-ui-painel.md ("Privacidade") e AGENTS.md.
 *
 * Id da flag = `<tela>.<dado>`. A tela é a chave de agrupamento no diálogo.
 */
export const PRIVACY_SCREENS = [
  {
    id: 'layout',
    label: 'Painel (menu)',
    flags: [
      { id: 'layout.userIdentity', label: 'E-mail e papel do usuário' },
    ],
  },
  {
    id: 'offers',
    label: 'Gerador de ofertas',
    flags: [
      { id: 'offers.sessionName', label: 'Nome e número da sessão' },
      { id: 'offers.groupAvatars', label: 'Fotos dos grupos' },
      { id: 'offers.groupNames', label: 'Nomes dos grupos' },
      { id: 'offers.audience', label: 'Público-alvo escolhido' },
      { id: 'offers.productImages', label: 'Imagens dos produtos' },
      { id: 'offers.productText', label: 'Título e texto das ofertas' },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoramento',
    flags: [
      { id: 'monitoring.sessionName', label: 'Nome e número da sessão' },
      { id: 'monitoring.groupAvatars', label: 'Fotos dos grupos' },
      { id: 'monitoring.groupNames', label: 'Nomes dos grupos' },
      { id: 'monitoring.capturedText', label: 'Texto das ofertas capturadas' },
      { id: 'monitoring.capturedImages', label: 'Imagens das ofertas capturadas' },
    ],
  },
  {
    id: 'linkRotation',
    label: 'Rodízio de links',
    flags: [
      { id: 'linkRotation.rotationLink', label: 'Link público e apelido' },
      { id: 'linkRotation.sessionName', label: 'Nome da sessão' },
      { id: 'linkRotation.groupName', label: 'Nomes dos grupos' },
      { id: 'linkRotation.groupAvatar', label: 'Fotos dos grupos' },
      { id: 'linkRotation.inviteLink', label: 'Link de convite dos grupos' },
    ],
  },
] as const;

export type PrivacyScreenId = (typeof PRIVACY_SCREENS)[number]['id'];
export type PrivacyFlag = (typeof PRIVACY_SCREENS)[number]['flags'][number]['id'];

export const ALL_PRIVACY_FLAGS: readonly PrivacyFlag[] = PRIVACY_SCREENS.flatMap((s) => s.flags.map((f) => f.id));

export function isPrivacyFlag(value: unknown): value is PrivacyFlag {
  return typeof value === 'string' && (ALL_PRIVACY_FLAGS as readonly string[]).includes(value);
}
