/**
 * Texto da Política de Privacidade (página pública `/politicas-de-privacidade`).
 * Regras de `features/invite/strings.ts`: chaves semânticas; marca só via `APP_NAME`
 * ({{app}} é trocado na página). Mudou o texto → atualizar `updatedAt`.
 * É a fonte da verdade da política: a URL da Chrome Web Store aponta para esta página
 * (ver docs/extensao-publicacao-chrome-web-store.md §8 e §10).
 */
export interface PolicySection {
  title: string;
  /** Parágrafos antes das listas. */
  intro?: readonly string[];
  /** Blocos: subtítulo opcional + parágrafos e/ou itens. Item `**x:** y` vira negrito no prefixo. */
  blocks?: readonly {
    subtitle?: string;
    paragraphs?: readonly string[];
    items?: readonly string[];
  }[];
  /** Parágrafos depois das listas. */
  outro?: readonly string[];
}

export const privacyPolicyStrings = {
  pageTitle: 'Políticas de Privacidade',
  title: 'Política de Privacidade – {{app}}',
  updatedAt: 'Última atualização: 02 de novembro de 2026',
  backToLogin: 'Ir para o login',
  metaDescription:
    'Quais dados o painel e a extensão para Chrome coletam, como são usados, com quem são compartilhados e como exercer seus direitos.',
  intro: [
    'A sua privacidade é importante para nós. Esta Política de Privacidade explica como o {{app}} (“nós”, “nosso” ou “serviço”), acessível pelo domínio copysync.app, por meio do painel app.copysync.app e da extensão {{app}} para Google Chrome, coleta, usa, armazena, compartilha e protege as informações dos usuários (“você”), em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD).',
    'Ao criar uma conta, utilizar o painel ou instalar a extensão, você concorda com as práticas descritas nesta política.',
  ],
  sections: [
    {
      title: '1. Informações que coletamos',
      intro: ['Coletamos apenas o necessário para prestar um serviço de automação de links de afiliado e divulgação de ofertas.'],
      blocks: [
        {
          subtitle: '1.1. Informações de conta (autenticação)',
          items: [
            '**Endereço de e-mail e nome:** para identificação única da sua conta, login e comunicação operacional.',
            '**Credenciais de acesso:** a senha é armazenada apenas em forma de hash criptográfico. Nunca guardamos nem temos acesso à senha em texto puro.',
            '**Dados do seu negócio no painel:** nome da empresa/equipe, membros convidados e plano contratado.',
          ],
        },
        {
          subtitle: '1.2. Dados de operação do painel',
          items: [
            '**Sessões de mensageria:** número de telefone declarado, estado de conexão e credenciais de pareamento, armazenadas cifradas e usadas só para manter a sessão ativa.',
            '**Grupos, contatos e mensagens:** conteúdo necessário para monitorar grupos de origem, espelhar ofertas e enviar mensagens que você configurou. Você é o controlador desses dados; o serviço atua como operador.',
            '**Ofertas e links:** URLs de produtos, preços, imagens e textos extraídos de marketplaces parceiros (ex.: Mercado Livre, Shopee, Amazon) para gerar links de afiliado, páginas de ofertas e artes.',
            '**Credenciais de afiliado:** chaves e etiquetas de programas de afiliado que você cadastra. São cifradas em repouso, nunca exibidas de volta nem registradas em logs.',
            '**Chaves de provedores de IA (opcional):** se você optar por usar a própria chave, ela é cifrada e usada apenas para gerar textos a seu pedido.',
          ],
        },
        {
          subtitle: '1.3. Dados coletados pela extensão para Chrome',
          paragraphs: [
            'A extensão tem uma finalidade única: sincronizar a sessão de afiliado do Mercado Livre que você já tem aberta no navegador com o painel ao qual você está autenticado. Para isso ela coleta:',
          ],
          items: [
            '**Cookies de identidade da sessão do Mercado Livre** (ssid, orguseridp, orgnickp, orguserid), lidos exclusivamente do domínio mercadolivre.com.br. Eles contêm o seu identificador e apelido de usuário no marketplace.',
            '**Identificador aleatório de instalação,** versão da extensão e eventos de ciclo de vida (instalação, atualização, desinstalação, verificação periódica).',
          ],
        },
        {
          paragraphs: [
            'A extensão não lê senhas, histórico de navegação, conteúdo de páginas, localização ou cookies de qualquer outro site. Ela não injeta código nas páginas que você visita nem altera o que você vê.',
          ],
        },
        {
          subtitle: '1.4. Dados técnicos e cookies do site',
          items: [
            '**Cookies estritamente necessários:** o painel usa um cookie de sessão HttpOnly, Secure e SameSite para manter você autenticado. Sem ele o login não funciona.',
            '**Preferências locais:** tema (claro/escuro), rascunhos de formulário e filtros ficam no armazenamento do seu navegador e não são enviados a nós.',
            '**Registros técnicos:** endereço IP, agente do navegador, data/hora e rotas acessadas, mantidos em logs de segurança por tempo limitado para prevenir abuso e diagnosticar falhas.',
            'Não utilizamos cookies de rastreamento publicitário nem de redes sociais no painel ou na extensão.',
          ],
        },
      ],
    },
    {
      title: '2. Permissões da extensão e tecnologias utilizadas',
      intro: ['Em conformidade com as políticas da Chrome Web Store, detalhamos cada permissão solicitada:'],
      blocks: [
        {
          items: [
            '**cookies:** ler os cookies de identidade da sessão do Mercado Livre e detectar quando mudam, para enviá-los ao painel. Nenhum cookie de outro site é acessado.',
            '**storage:** guardar o estado local da extensão: id de instalação, resultado da última sincronização, hash da sessão e preferência de tema. Não armazena senha nem token de login.',
            '**alarms:** agendar a renovação periódica da sessão, a verificação de saúde com o painel e o intervalo mínimo entre sincronizações, já que o processo em segundo plano do Chrome não fica ativo o tempo todo.',
            '**Acesso a *.mercadolivre.com.br:** escopo dos cookies de sessão lidos. Nenhum script é injetado nessas páginas.',
            '**Acesso a api.copysync.app e app.copysync.app:** comunicação autenticada com o nosso servidor e com o painel: envio da sessão, verificação de validade e abertura da aba do painel ao clicar no ícone.',
          ],
        },
      ],
      outro: [
        'A extensão não carrega nem executa código remoto; todo o código vai no pacote publicado. Recursos opcionais da extensão (como a renovação automática da sessão e o tema) podem ser desativados no painel em Configurações → Extensão ou desinstalando a extensão.',
      ],
    },
    {
      title: '3. Como usamos suas informações',
      blocks: [
        {
          items: [
            '**Autenticação:** verificar sua identidade e conceder acesso ao painel e à extensão.',
            '**Operação do serviço:** gerar links de afiliado com a sua própria conta e etiqueta, monitorar e espelhar grupos, publicar páginas de ofertas, criar artes e enviar mensagens que você programou.',
            '**Manutenção da integração:** verificar se a sessão do marketplace continua válida e renová-la quando mudar.',
            '**Suporte e melhorias:** diagnosticar erros, medir desempenho e evoluir o produto.',
            '**Cobrança:** processar o plano contratado e aplicar os limites correspondentes.',
            '**Segurança e obrigações legais:** prevenir fraude e abuso e cumprir exigências legais ou regulatórias.',
          ],
        },
      ],
      outro: [
        'Não vendemos, alugamos nem compartilhamos seus dados pessoais com terceiros para fins de marketing, e não usamos dados para avaliação de crédito ou perfilamento.',
      ],
    },
    {
      title: '4. Compartilhamento de dados',
      intro: ['Compartilhamos dados apenas com quem é indispensável para operar o serviço, sempre sob contrato e limitado à finalidade:'],
      blocks: [
        {
          items: [
            '**Provedores de infraestrutura:** hospedagem, banco de dados e armazenamento de mídia (servidores e CDN). Eles processam dados em nosso nome e não têm acesso ao conteúdo cifrado.',
            '**Marketplaces e programas de afiliado:** ao gerar um link, enviamos ao marketplace a URL do produto e a sua credencial de afiliado, conforme as regras do próprio programa.',
            '**Plataforma de mensageria:** mensagens que você configura são entregues pelo serviço de mensagens conectado à sua sessão.',
            '**Provedores de inteligência artificial:** apenas o texto que você pede para gerar ou reescrever é enviado ao provedor, sem dados de conta. Se você usa a própria chave, o envio ocorre em seu nome.',
            '**Processamento de pagamentos:** dados de cobrança são tratados pelo nosso hub de faturamento e pelo gateway de pagamento. O serviço não armazena número de cartão.',
            '**Autoridades:** quando exigido por lei, ordem judicial ou para proteger direitos, segurança ou propriedade.',
          ],
        },
      ],
      outro: ['Alguns provedores podem estar localizados fora do Brasil. Nesses casos, a transferência observa as salvaguardas previstas na LGPD.'],
    },
    {
      title: '5. Tratamento, armazenamento e segurança',
      blocks: [
        {
          items: [
            'Toda a comunicação entre navegador, extensão e servidores usa HTTPS/TLS.',
            'Senhas são armazenadas em hash; sessões de marketplace, credenciais de afiliado e chaves de IA são cifradas em repouso e nunca devolvidas nem registradas em logs.',
            'Dados locais da extensão ficam no ambiente seguro do navegador (Chrome Storage API) e são removidos com a desinstalação.',
            'Acesso interno aos dados é restrito, registrado e limitado ao necessário para suporte.',
            'Os dados são mantidos enquanto sua conta estiver ativa ou pelo prazo exigido por lei. Mídias e mensagens de grupos seguem prazos de retenção configuráveis e são expurgadas automaticamente.',
          ],
        },
      ],
    },
    {
      title: '6. Seus direitos',
      intro: ['Nos termos da LGPD, você pode a qualquer momento:'],
      blocks: [
        {
          items: [
            'Confirmar a existência de tratamento e acessar os dados que mantemos sobre você.',
            'Solicitar correção de dados incompletos, inexatos ou desatualizados.',
            'Solicitar anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade.',
            'Solicitar a portabilidade dos seus dados.',
            'Revogar o consentimento e solicitar a exclusão da sua conta e de todos os dados associados.',
            'Desconectar a sessão do marketplace em Configurações → Extensão no painel, o que apaga a sessão guardada, ou desinstalar a extensão, o que revoga a autorização.',
          ],
        },
      ],
      outro: ['Para exercer esses direitos, entre em contato pelos canais da seção 8. Responderemos no prazo legal.'],
    },
    {
      title: '7. Alterações nesta política',
      intro: [
        'Podemos atualizar esta Política de Privacidade periodicamente para refletir mudanças em nossas práticas ou por razões legais. A data da última atualização aparece no topo da página. Recomendamos que você a revise regularmente. O uso contínuo do serviço após as alterações constitui aceitação da nova política.',
      ],
    },
    {
      title: '8. Contato',
      intro: ['Dúvidas sobre esta Política de Privacidade, sobre o tratamento dos seus dados ou solicitações como titular:'],
      blocks: [{ items: ['**E-mail:** suporte@copysync.app', '**Website:** https://copysync.app'] }],
    },
  ] as readonly PolicySection[],
} as const;

/** Rótulo do link discreto na tela de login. */
export const PRIVACY_POLICY_PATH = '/politicas-de-privacidade';
export const privacyPolicyLinkLabel = 'Política de Privacidade';
