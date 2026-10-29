# Rodízio de links — decisões do owner (2026-10-28)

Fonte: conversa de especificação. Referência visual: Redirect Flow ("Gerenciador de Rodízios WhatsApp"):
card por sessão → Configurar subdomínio → Grupos → Copiar link. Termo de produto: **rodízio de links**;
módulo `campaigns/link-rotation` (roadmap item 9). Nunca "instância": aqui é **sessão**.

| # | Dúvida | Decisão | Por quê |
| --- | --- | --- | --- |
| 1 | Onde vive a lista de domínios + tela do admin | **API CopySync, super-admin** (`/admin/link-domains`, padrão de `/admin/ai`). Hub segue só billing | Doc de billing proíbe acoplar operação ao hub; redirect já é servido pela API |
| 2 | Origem do link `chat.whatsapp.com/…` | **Automático via sessão** (invite code pelo Baileys, exige sessão admin do grupo) **+ manual** (usuário cola o link quando não é admin) | Flexível; não trava quem não é admin |
| 3 | O que o visitante vê | **Página leve + botão "Entrar no grupo"**, auto-redirect curto | Funciona em navegador in-app (Instagram/TikTok), preview OG, clique contado com precisão |
| 4 | Estratégias de rotação v1 | **Equilibrado (default), Sequencial (encher e passar), Pesos manuais, Aleatório** | Amplia espectro estratégico do tenant |
| 5 | Rodízios por plano | **`link_rotations` = 1 / 1 / 2** (Starter / Profissional / Business) = `whatsapp_sessions` | Business pode ter um por sessão; subir depois é só preset |
| 6 | Grupos por rodízio | **3 / 5 / 10** (`link_rotation_groups`). Menos que o limite sempre aceito; tentar mais → aviso animado de upgrade com link `/plans` | Pedido do owner |
| 7 | Grupo cheio | **Clique contado + membros conferidos pela conexão Baileys da sessão do número**. Teto por grupo configurável, default 1000 (margem sobre 1024) | WhatsApp limita a 1024; cliques sozinhos não descontam quem saiu |
| 8 | Trocar subdomínio | **Sim, com aviso**; nome antigo reservado 30 dias para o mesmo tenant | Link antigo ainda circula nas redes |
| 9 | DNS | **Wildcard via Cloudflare na frente** (`*.dominio` proxied → API). Protege contra crawlers (AGENTS.md) | Owner controla DNS; já queria Cloudflare |

Fora da v1 (deferido): mais de um rodízio por sessão no Profissional; domínio próprio do cliente (roadmap 15);
Telegram; estatísticas por origem (UTM) além de contagem simples.
| 10 | Apex do domínio (Render exige apex no mesmo serviço do wildcard) | **Apex vai para a API**, que responde 301 para `landingUrl` do domínio (cadastrada pelo admin) | Mantém landing onde está; só o registro DNS do apex muda |
| 11 | Domínio de validação do wildcard | **`copysync.com.br`** (registrado no registro.br, zona nova e vazia) vai para a Cloudflare e serve de piloto do rodízio. `copysync.app` (apex da landing, `app.` e `api.`) fica intocado nesta fase | Valida wildcard na Render e webviews sem risco para o painel; o apex do `.com.br` está livre, então não precisa mover landing nenhuma |
| 12 | Quantos domínios base no rodízio | **Um domínio por vez**, começando por `copysync.com.br`. Domínio raiz adicional entra só com custo explícito | A Render inclui **2 custom domains** no plano do workspace e já estão em uso (`copysync.app` + `copysync.com.br`). Ela agrupa por domínio raiz: wildcard, apex e www contam como um. Cada raiz a mais é cobrada à parte ou exige upgrade |

| 13 | Proxy da Cloudflare (nuvem laranja) no domínio de rodízio | **Laranja só na T24, no lançamento.** Validado em 2026-10-29: com os cinco registros em *DNS only*, a Render emitiu certificado Let's Encrypt para `copysync.com.br` + `*.copysync.com.br` e `https://teste.copysync.com.br/health` responde 200 do serviço `copysync_api`. A cadeia funciona sem proxy porque a própria Render serve atrás de edge Cloudflare. Ligar o proxy agora não acrescenta nada e pode quebrar o renew do certificado. Fica para quando a página pública existir e precisar de WAF, rate limit e bloqueio de crawler. Pré-requisitos de quando ligar: SSL/TLS em **Full (strict)**, Bot Fight Mode desligado, regra WAF *Skip* para user agent de webview de Instagram/TikTok, rate limit por IP na rota pública. |

| 14 | Domínio de rodízio da v1 e `landingUrl` do apex | **Domínio da v1 é `copysync.com.br`** (confirmado pelo dono em 2026-10-29). Nenhum `landingUrl` definido agora. O super-admin cadastra pela tela de domínios quando quiser (`UpdateLinkDomainUseCase`, campo opcional). Enquanto o campo estiver vazio, o apex responde a página 404 da marca. Não fixar URL em código, seed ou env. |
| 15 | Tenant sem plano ou sem a chave de entitlement | **Segue a convenção do projeto: chave numérica ausente = ilimitado** (`entitlementKeys.ts`). Medido em produção em 2026-10-29: os 4 tenants estão sem `planSlug` e só o preset `marketplace_extension` existe no banco, então hoje todo limite numérico já é ilimitado para eles. Os presets do rodízio entram por data migration na T2 e chegam ao tenant no próximo evento de plano do hub (`SyncTenantEntitlementsUseCase`). Se o produto quiser piso de Starter para tenant sem plano, é mudança transversal a todos os limites, fora deste escopo. |
