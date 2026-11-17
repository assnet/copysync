# Saver — decisões do dono

Fonte: `spec.md` ("Decisões do dono", 2026-11-10 e 2026-11-11) e a ordem de implementar (2026-11-17). Produto
`SAVER` no menu, roadmap item 18 (`docs/produto-roadmap.md`, seção "Planos do Saver"). Termo de produto: **sessão**.

## Fechadas

| # | Tema | Decisão |
| --- | --- | --- |
| D1 | Planos | `SAVER_LITE`: 10 grupos, 10 mil contatos, 1 sessão WhatsApp. `SAVER_PRO`: 50 grupos, 50 mil contatos, 1 sessão. `SAVER_MAX`: grupos e contatos ilimitados (`null` explícito), 2 sessões. Telegram 0 nos três (`telegram_sessions: 0` obrigatório no preset) |
| D1 | Preço (só vitrine, nunca no banco) | Mensal, por mês: R$ 29,90 / 39,90 / 49,90. Anual, por mês: R$ 23,90 / 32,90 / 39,90, cobrado anualmente: R$ 286,80 / 394,80 / 478,80. Slugs `copysync-saver-{lite\|pro\|max}-{mensal\|anual}` |
| D1 | Leituras por dia (`saver_group_scans_per_day`) | **Adotado em 2026-11-17** (valores propostos em `design.md` §2.1, aceitos pelo dono ao mandar implementar): LITE 20, PRO 100, MAX 500. Teto no MAX é proteção do número do cliente, não limite comercial |
| D1 | Atualização diária (`saver_auto_refresh_enabled`) | **Adotado em 2026-11-17** (mesma origem): LITE não, PRO sim, MAX sim. A execução diária em si é P2 (T29) |
| D2 | Permissões | Matriz por papel: `ADMIN`/`SUPER_ADMIN` ver, extrair, exportar, configurar. `OPERATOR` ver e extrair; exportar só com liberação individual dada por `ADMIN` (tabela `saver_export_grants`). Sem RBAC geral |
| D3 | Tagline do menu | "Exporte os contatos dos seus grupos" |
| D5 | Dono dos dados | Base de contatos é **da plataforma**: contato único (telefone e LID únicos no banco), sem `tenantId`, vínculo por grupo do tenant com nome lido e data e hora da extração. Tenant nunca navega nos contatos (só contagens e arquivo). Só o super admin consulta a base de todos os tenants, sempre auditado |
| D6 | `/members` | Redireciona para `/saver` |
| — | Telefone | Dado principal: nunca apagado nem trocado por leitura sem ele; leitura só preenche campo vazio |
| — | Sem foto de perfil | Fora (custo e risco) |

## Regras derivadas para o código

- Chave `saver_*` ausente = zero/desligado; `null` explícito = ilimitado (`saverLimits.ts`). Não herdar a convenção
  "ausente = ilimitado" do resto do projeto.
- Domínio do Saver usa constante própria `SAVER_LIMIT_KEYS` com os mesmos valores de `entitlementKeys.ts`
  (`saver_groups`, `saver_group_scans_per_day`, `saver_contacts`, `saver_auto_refresh_enabled`).
- Exportação do tenant usa o nome do vínculo, nunca o do contato global (SAVER-46). Datas em `America/Sao_Paulo`.
- Fusão de contatos só quando a mesma leitura traz LID e telefone juntos; nunca por nome.

## Adiadas (não bloqueiam a v1)

- **D4** aviso de uso responsável (LGPD): P2 (SAVER-42, T31); o dono avisa quando entrar.
- **D5 retenção/expurgo** (SAVER-34/35): v1 não apaga nada sozinha; só remoção lógica de grupo.

## Bloqueio de venda em escala

Com a base sendo da plataforma, a CopySync passa a controladora de dado pessoal de terceiros. Antes de vender em
escala: termos de uso dizendo ao tenant que os contatos extraídos ficam guardados pela plataforma, base legal, canal
de exclusão a pedido do titular e regra de retenção. Decisão do dono com apoio jurídico; o código só reserva o lugar
(T27 documenta, T31 traz o aceite).
