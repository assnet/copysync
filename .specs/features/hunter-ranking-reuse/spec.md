# Caçador: reaproveitar o ranking + audiência por flag no admin — spec

Estado: em implementação (pedido do dono, 2026-11-16). Base: api 0.96.1 · app 0.120.0.

## Decisões do dono

- Reaproveitar ofertas do ranking ("Fora do corte") é **manual**, uma a uma, para quem usa o caçador.
- **Não conta** no teto `offer_hunter_finds_per_day` (o teto é da busca). Valem: repetição da caçada (produto já
  enviado dentro de `repeatAfterDays` é pulado), portões da marca (plano, caçador, credencial, aceite), destino, fila e
  intervalo do gerador. Ranking reaproveitável só de execuções das **últimas 48 h** (preço/estoque mudam).
- "Enviar todas as não escolhidas" de uma execução: **só super admin**.
- Audiência do caçador vira **flag no admin** (`/admin/plan-entitlements`, coluna "Só super admin"): ligada = só super
  admin vê/usa; desligada = todos os planos com `offer_hunter_enabled`. Substitui o uso da env
  `OFFER_HUNTER_AUDIENCE` (que vira só valor inicial quando a flag nunca foi gravada).

## Contrato fixo

- `POST /api/offer-hunts/:id/runs/:runId/ranking/:productId/send` → 200 `{ find }` (achado novo, entregue pelo
  `HuntFindDelivery`, `origin HUNTER`, `sourceKey hunt:rank:<runId>:<productId>`). Erros: 404 `OFFER_HUNT_NOT_FOUND`
  (caçada/execução/produto fora do ranking), 409 `OFFER_HUNT_ALREADY_SENT` (repetição ou já enviado desta execução),
  409 `OFFER_HUNT_RANKING_EXPIRED` (> 48 h), 422 `OFFER_HUNT_DESTINATION_REQUIRED`, portões como na execução.
- `POST /api/offer-hunts/:id/runs/:runId/ranking/send-all` (**super admin**; demais 403) → 200
  `{ sent: number, skipped: [{ productId, reason }] }` — envia todos os itens não escolhidos e ainda não enviados, em
  sequência, parando em erro de portão (credencial/aceite/plano).
- `GET /api/offer-hunts/:id/runs/:runId` passa a trazer `sentProductIds: string[]` (achados desta execução, escolhidos ou
  reaproveitados) e `rankingReusable: boolean` (≤ 48 h).
- Admin: `GET /api/admin/plan-entitlements` → cada chave ganha `superAdminOnly: boolean | null` (null = não se aplica;
  hoje só `offer_hunter_enabled` aplica). `PUT /api/admin/plan-entitlements/:key/audience` `{ superAdminOnly: boolean }`
  (super admin; chave sem audiência → 400). Persistência: `platform_settings` chave `feature_audience`
  (`{ offer_hunter_enabled: boolean }`), auditoria `PLAN_ENTITLEMENT_CHANGED` com `meta.audience`.
- `GET /api/offer-hunts/access` e o portão das rotas leem a flag a cada pedido (cache curto ≤ 30 s permitido).
