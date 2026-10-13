# Credenciais de afiliado — Especificação

**Módulo**: `integrations/affiliate-credentials` (api/) + `settings` feature (app/)
**Roadmap**: item 3 de `docs/produto-roadmap.md` ("Credenciais de afiliado")
**Escopo**: Large (Prisma → criptografia → use cases → REST → página em Configurações)
**Status**: Draft — 2026-10-13. Aguarda aprovação do usuário.

---

## Problem Statement

O produto só gera valor se trocar o link do concorrente pelo link de afiliado do cliente. Para
isso precisa guardar, por tenant, as credenciais de cada marketplace (Shopee, Mercado Livre,
Amazon). Hoje não existe módulo `integrations`, nem lugar no painel, nem criptografia de segredo
em repouso. Esta tela é o primeiro item da ordem de entrega do roadmap e pré-requisito do
Gerador de ofertas e do Monitoramento.

## Goals

- [ ] Operador cadastra, edita e remove credenciais de Shopee, Mercado Livre e Amazon em
      Configurações → Credenciais de afiliado, em menos de 1 minuto por marketplace
- [ ] Segredo nunca volta em claro pela API após salvo: resposta sempre mascarada
- [ ] Segredo gravado cifrado (AES-256-GCM) com chave fora do banco
- [ ] Contrato `IAffiliateCredentialRepository` pronto para o Gerador de ofertas consumir sem
      conhecer Prisma nem cifra
- [ ] Zero marca no código: nomes descrevem o recurso (`affiliate-credentials`), não o produto

## Out of Scope

| Item | Motivo |
| --- | --- |
| Gerar link de afiliado | Pertence ao `campaigns/offer-generator` (roadmap 8); aqui só se guarda a chave |
| Validar credencial contra a API do marketplace | P3; Shopee tem API assinada, ML e Amazon não têm endpoint de teste barato. Entra quando o gerador existir |
| OAuth (login com conta do marketplace) | Nenhum dos três exige para o programa de afiliados |
| Limite por plano | Tabela de planos libera os 3 marketplaces em todos os planos |
| Biblioteca de i18n | Bloqueio registrado em `STATE.md`: textos ficam em `features/settings/strings.ts`, prontos para extração |
| Modo "sistema" no tema | `ColorModeProvider` só tem claro/escuro (gap pré-existente, chore próprio) |

---

## Campos por marketplace (assunção, verificar em design)

| Marketplace | Campo público | Campo secreto |
| --- | --- | --- |
| Shopee | App ID | Secret Key |
| Mercado Livre | ID do afiliado | — |
| Amazon | Tag de associado | — |

Fonte: app de referência (capturas). Verificação contra a documentação oficial é a task T0.

---

## User Stories

### P1: Cadastrar e ver credenciais ⭐ MVP

**User Story**: Como operador do tenant, quero informar as chaves de cada marketplace para que
a ferramenta monetize meus links automaticamente.

**Why P1**: Sem isso nenhuma outra feature do roadmap funciona.

**Acceptance Criteria**:

1. WHEN o operador abre Configurações THEN o submenu SHALL mostrar "Credenciais de afiliado" ao
   lado de "Minha conta"
2. WHEN a página carrega THEN o sistema SHALL mostrar um card por marketplace (Shopee, Mercado
   Livre, Amazon) com estado "Não configurado" ou "Configurado"
3. WHEN o operador clica "Configurar" e salva campos válidos THEN a API SHALL gravar a
   credencial do tenant (`PUT /integrations/affiliate-credentials/:provider`) e o card SHALL
   mudar para "Configurado" sem recarregar a página
4. WHEN a credencial existe THEN o card SHALL exibir o campo público mascarado (ex.
   `••••3128`) e o secreto como `••••••••`, nunca o valor em claro
5. WHEN o operador salva campo vazio ou fora do formato THEN o sistema SHALL recusar com
   mensagem no campo, sem chamar a API
6. WHEN a API responde erro THEN o diálogo SHALL manter os valores digitados e mostrar a mensagem

**Independent Test**: Logar, abrir Configurações → Credenciais de afiliado, salvar Shopee com App
ID + Secret, recarregar: card "Configurado", valores mascarados, `SELECT` na tabela mostra
`secretCiphertext` ilegível.

---

### P1: Editar e remover credencial ⭐ MVP

**User Story**: Como operador, quero trocar ou apagar uma chave quando o marketplace a renovar
ou quando eu deixar o programa.

**Acceptance Criteria**:

1. WHEN o operador clica "Editar credenciais" THEN o diálogo SHALL abrir com o campo público
   preenchido e o secreto vazio com placeholder "mantido se vazio"
2. WHEN salva com secreto vazio THEN a API SHALL manter o secreto atual e atualizar só o público
3. WHEN clica "Remover" e confirma no `ConfirmDialog` THEN a API SHALL apagar a linha
   (`DELETE .../:provider`) e o card SHALL voltar a "Não configurado"
4. WHEN qualquer gravação ou remoção ocorre THEN o sistema SHALL registrar `AuditLog`
   (`AFFILIATE_CREDENTIAL_UPSERTED` / `AFFILIATE_CREDENTIAL_DELETED`) sem o valor da chave

**Independent Test**: Editar App ID da Shopee deixando Secret vazio; recarregar; público novo,
`secretCiphertext` inalterado no banco. Remover; card volta ao estado inicial; `audit_logs` tem
as duas ações.

---

### P2: Ativar / desativar sem apagar

**User Story**: Como operador, quero pausar um marketplace sem perder a chave.

**Acceptance Criteria**:

1. WHEN o operador alterna o switch "Ativo" THEN a API SHALL gravar `status` (`ACTIVE` /
   `INACTIVE`) via `PATCH .../:provider/status`
2. WHEN `INACTIVE` THEN o card SHALL mostrar chip "Inativo" e o contrato de leitura
   `findActiveByTenantAndProvider` SHALL ignorar a credencial

**Independent Test**: Desativar Amazon; `GET` lista `status: INACTIVE`; leitura "ativa" não retorna.

---

### P3: Testar credencial

**User Story**: Como operador, quero saber se a chave da Shopee está certa antes de depender dela.

**Acceptance Criteria**:

1. WHEN clica "Testar" THEN a API SHALL chamar o endpoint de validação do marketplace (quando
   existir) e gravar `lastValidatedAt` + resultado
2. WHEN o marketplace não tem validação THEN o botão SHALL ficar oculto

---

## Edge Cases

- WHEN dois `PUT` simultâneos do mesmo tenant/provider THEN SHALL prevalecer o último
  (`@@unique([tenantId, provider])` + `upsert`), sem linha duplicada
- WHEN `CREDENTIALS_ENCRYPTION_KEY` ausente ou com tamanho errado THEN a API SHALL falhar no boot
  (validação em `env.ts`), nunca gravar em claro
- WHEN a chave de cifra for rotacionada THEN o registro SHALL guardar `keyVersion` para
  permitir recifrar em script (`scripts/maintenance/`); rotação em si fica fora do escopo
- WHEN tenant de outra membership tenta `GET` THEN `tenantHook` SHALL negar (já existe)
- WHEN o campo público tiver espaços nas pontas THEN o sistema SHALL fazer `trim` antes de validar
- WHEN resposta de `GET` for lista vazia THEN os 3 cards SHALL aparecer em "Não configurado"
  (catálogo de provedores é do painel, não do banco)
- WHEN o painel estiver em modo escuro THEN cards, chips e diálogo SHALL usar tokens do tema
  (teste com `renderWithTheme('dark')`)

---

## Requirement Traceability

| ID | Story | Fase | Status |
| --- | --- | --- | --- |
| AFCRED-01 | P1 cadastrar: submenu em Configurações | Design | Pending |
| AFCRED-02 | P1 cadastrar: cards por marketplace com estado | Design | Pending |
| AFCRED-03 | P1 cadastrar: `PUT` upsert por tenant/provider | Design | Pending |
| AFCRED-04 | P1 cadastrar: resposta mascarada, nunca em claro | Design | Pending |
| AFCRED-05 | P1 cadastrar: validação de campos no painel | Design | Pending |
| AFCRED-06 | P1 cadastrar: cifra AES-256-GCM em repouso | Design | Pending |
| AFCRED-07 | P1 editar: secreto vazio mantém o atual | Design | Pending |
| AFCRED-08 | P1 remover: `DELETE` + confirmação | Design | Pending |
| AFCRED-09 | P1: auditoria de upsert/delete | Design | Pending |
| AFCRED-10 | P2: status ativo/inativo | — | Pending |
| AFCRED-11 | P3: testar credencial | — | Pending |
| AFCRED-12 | transversal: textos centralizados (`strings.ts`), tema escuro | Design | Pending |

**Coverage:** 12 total, 0 mapeados em tasks, 12 pendentes ⚠️ (atualizar em `tasks.md`)

---

## Success Criteria

- [ ] Fluxo P1 completo em < 1 min por marketplace, sem reload
- [ ] `grep` por valor da secret no dump do banco retorna zero
- [ ] `pnpm typecheck && pnpm test` verdes em `api/` e `app/`
- [ ] Nenhum Prisma fora de `infrastructure/`, nenhuma marca do produto em nome de código
- [ ] `docs/integracoes-credenciais-afiliado.md` escrito; roadmap item 3 marcado ✅
