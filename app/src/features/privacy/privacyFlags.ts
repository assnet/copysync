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
      { id: 'layout.tenantName', label: 'Nome do tenant no cabeçalho' },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessões',
    flags: [
      { id: 'sessions.sessionName', label: 'Nome da sessão' },
      { id: 'sessions.sessionPhone', label: 'Número ou telefone da sessão' },
      { id: 'sessions.sessionAvatar', label: 'Foto da sessão' },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    flags: [
      { id: 'chat.linkPreviewImages', label: 'Miniaturas das prévias de link' },
      { id: 'chat.linkPreviewText', label: 'Título, descrição e domínio das prévias de link' },
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
      { id: 'monitoring.sessionAvatar', label: 'Foto da sessão' },
      { id: 'monitoring.keywords', label: 'Palavras-chave dos grupos' },
      { id: 'monitoring.groupAvatars', label: 'Fotos dos grupos' },
      { id: 'monitoring.groupNames', label: 'Nomes dos grupos' },
      { id: 'monitoring.capturedText', label: 'Texto das ofertas capturadas' },
      { id: 'monitoring.capturedImages', label: 'Imagens das ofertas capturadas' },
    ],
  },
  {
    id: 'broadcastGroups',
    label: 'Grupos de disparo',
    flags: [
      { id: 'broadcastGroups.groupNames', label: 'Nomes dos grupos' },
      { id: 'broadcastGroups.groupAvatars', label: 'Fotos dos grupos' },
      { id: 'broadcastGroups.sessionName', label: 'Nome e número da sessão' },
    ],
  },
  {
    id: 'linkRotation',
    label: 'Gestor de Links',
    flags: [
      { id: 'linkRotation.rotationLink', label: 'Link público e apelido' },
      { id: 'linkRotation.sessionName', label: 'Nome da sessão' },
      { id: 'linkRotation.sessionAvatar', label: 'Foto da sessão' },
      { id: 'linkRotation.groupName', label: 'Nomes dos grupos' },
      { id: 'linkRotation.groupAvatar', label: 'Fotos dos grupos' },
      { id: 'linkRotation.inviteLink', label: 'Link de convite dos grupos' },
    ],
  },
  {
    id: 'storefront',
    label: 'Página de Ofertas',
    flags: [
      { id: 'storefront.name', label: 'Nome da página' },
      { id: 'storefront.photo', label: 'Foto de perfil' },
      { id: 'storefront.cover', label: 'Imagem de capa' },
      { id: 'storefront.subdomain', label: 'Endereço (subdomínio)' },
      { id: 'storefront.offerTitle', label: 'Título das ofertas' },
      { id: 'storefront.offerImage', label: 'Imagens das ofertas' },
    ],
  },
  {
    id: 'offerStory',
    label: 'Story de Oferta',
    flags: [
      { id: 'offerStory.art', label: 'Arte gerada' },
      { id: 'offerStory.link', label: 'Links do produto e de afiliado' },
    ],
  },
  {
    id: 'offerHunter',
    label: 'Caçador de Ofertas',
    flags: [
      { id: 'offerHunter.sessionName', label: 'Nome da sessão' },
      { id: 'offerHunter.groupNames', label: 'Nomes dos grupos' },
      { id: 'offerHunter.groupAvatars', label: 'Fotos dos grupos' },
      { id: 'offerHunter.productImages', label: 'Imagens dos produtos' },
      { id: 'offerHunter.productText', label: 'Título e dados dos produtos' },
    ],
  },
  {
    id: 'affiliateCredentials',
    label: 'Credenciais de afiliado',
    flags: [
      { id: 'affiliateCredentials.sessionAffiliateId', label: 'ID de afiliado vindo da sessão (Shein)' },
      { id: 'affiliateCredentials.accountIdentifiers', label: 'Etiquetas da conta (Mercado Livre)' },
    ],
  },
  {
    id: 'subscription',
    label: 'Assinatura',
    flags: [
      { id: 'subscription.tenantName', label: 'Nome da conta' },
    ],
  },
  {
    id: 'costs',
    label: 'Custos da infraestrutura',
    flags: [
      { id: 'costs.tenantName', label: 'Nome do cliente' },
    ],
  },
] as const;

export type PrivacyScreenId = (typeof PRIVACY_SCREENS)[number]['id'];
export type PrivacyFlag = (typeof PRIVACY_SCREENS)[number]['flags'][number]['id'];

export const ALL_PRIVACY_FLAGS: readonly PrivacyFlag[] = PRIVACY_SCREENS.flatMap((s) => s.flags.map((f) => f.id));

export function isPrivacyFlag(value: unknown): value is PrivacyFlag {
  return typeof value === 'string' && (ALL_PRIVACY_FLAGS as readonly string[]).includes(value);
}
