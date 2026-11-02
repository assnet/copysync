/**
 * Textos da página pública de Suporte (`/suporte`). Mesmas regras de
 * `features/privacy-policy/strings.ts`: chaves semânticas, marca só via `{{app}}`.
 * É a "URL do suporte" declarada na Chrome Web Store (docs/extensao-publicacao-chrome-web-store.md).
 * Canais de contato: só aqui e em `privacy-policy/strings.ts` (seção Contato) — manter iguais.
 */
import type { DocumentSection } from '@/components/PublicDocumentPage';
import { PRIVACY_POLICY_PATH } from '@/features/privacy-policy/strings';

export const SUPPORT_PATH = '/suporte';
export const supportLinkLabel = 'Suporte';

export const SUPPORT_CONTACT = {
  email: 'suporte@copysync.app',
  website: 'https://copysync.app',
  /** Dias úteis, horário de Brasília. */
  hours: 'Segunda a sexta, das 9h às 18h (horário de Brasília)',
  /** Prazo de primeira resposta prometido ao usuário. */
  firstReply: 'Primeira resposta em até 1 dia útil',
} as const;

export const supportStrings = {
  pageTitle: 'Suporte',
  title: 'Suporte – {{app}}',
  subtitle: 'Ajuda com o painel e com a extensão para Google Chrome.',
  backToLogin: 'Ir para o login',
  intro: [
    'Precisa de ajuda? Fale com a equipe do {{app}} pelos canais abaixo. Para agilizar, informe o e-mail da sua conta, o que você tentou fazer e, se houver, a mensagem de erro exibida.',
  ],
  contactTitle: 'Canais de atendimento',
  contact: {
    emailLabel: 'E-mail',
    hoursLabel: 'Horário',
    firstReplyLabel: 'Prazo',
    websiteLabel: 'Site',
  },
  sections: [
    {
      title: 'Extensão para Chrome: perguntas frequentes',
      blocks: [
        {
          subtitle: 'O painel diz que a extensão não foi encontrada',
          items: [
            'Confirme que a extensão está instalada e ativada em chrome://extensions.',
            'Recarregue a aba do painel. A detecção acontece ao abrir Configurações → Extensão.',
            'Perfis diferentes do Chrome têm extensões diferentes: use o mesmo perfil no painel e no Mercado Livre.',
          ],
        },
        {
          subtitle: 'O Mercado Livre aparece como "Não logado"',
          items: [
            'Entre no Mercado Livre neste mesmo navegador e perfil, depois clique em "Sincronizar agora" no painel.',
            'A extensão lê apenas os cookies de identidade da sessão; se você saiu do Mercado Livre, a sessão some.',
            'Se a conta do Mercado Livre mudou, sincronize de novo para o painel passar a usar a conta atual.',
          ],
        },
        {
          subtitle: 'Como desconectar ou apagar minha sessão',
          items: [
            'Em Configurações → Extensão, use "Desconectar Mercado Livre". A sessão guardada é apagada na hora.',
            'Desinstalar a extensão também revoga a autorização desta instalação.',
          ],
        },
        {
          subtitle: 'Quais dados a extensão lê',
          items: [
            'Somente os cookies de identidade da sessão do Mercado Livre (ssid, orguseridp, orgnickp, orguserid). Nenhuma senha, histórico ou conteúdo de página.',
            `Detalhes na Política de Privacidade: ${PRIVACY_POLICY_PATH}`,
          ],
        },
      ],
    },
    {
      title: 'Painel: conta, plano e sessões',
      blocks: [
        {
          items: [
            '**Acesso e senha:** use "Esqueci minha senha" na tela de login ou peça ao administrador da sua equipe um novo convite.',
            '**Plano e limites:** o resumo do seu plano e o que cada um inclui está em Planos, dentro do painel.',
            '**Conexão de WhatsApp:** em Configurações → Sessões você conecta, reconecta e remove sessões. Mantenha o celular com internet.',
          ],
        },
      ],
    },
    {
      title: 'Privacidade e dados',
      intro: [
        `Solicitações de acesso, correção ou exclusão de dados (LGPD) podem ser feitas pelo e-mail de suporte. A Política de Privacidade completa está em ${PRIVACY_POLICY_PATH}.`,
      ],
    },
  ] as readonly DocumentSection[],
} as const;
