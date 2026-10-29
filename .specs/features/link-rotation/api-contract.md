# Contrato HTTP do rodízio de links (fonte: T10/T12, 2026-10-29)

Envelope de toda resposta: `{ success, data }`. Schemas fechados em
`api/src/modules/link-rotation/presentation/schemas/`. Campo desconhecido no corpo é descartado.

## Tenant — `/api/link-rotation` (`authHook`, `tenantHook`)

| Método | Caminho | Corpo | Resposta (`data`) |
| --- | --- | --- | --- |
| GET | `/` | — | `{ rotations: Rotation[], domains: {id, hostname}[], limits: {linkRotations, linkRotationGroups}` (null = ilimitado)`, sessions: {id, name, status}[] }` |
| POST | `/` | `{sessionId, domainId, slug, strategy?, title?}` (título ≤ 80) | 201 `Rotation` |
| PATCH | `/:id` | `{status?: ACTIVE\|PAUSED, strategy?, title?, sessionId?}` (≥ 1 campo) | `Rotation` |
| POST | `/:id/rename` | `{slug, domainId?}` | `Rotation` |
| DELETE | `/:id` | — | 204 |
| GET | `/:id/groups?search=` | — | `{ partial, groups: {groupJid, title, avatarUrl, conversationId\|null, selected, rotationGroupId\|null, status\|null}[] }` |
| PUT | `/:id/groups` | `{groups: {conversationId? \| groupJid?, position?, weight?, capacity?, manualInviteUrl?: string\|null}[]}` | `{ groups: Group[] }` |
| POST | `/:id/groups/:gid/refresh` | — | `Group` |
| GET | `/:id/stats` | — | `{ rotationId, clickCount, clicksLast7Days, lastClickAt, groups: {id, conversationId, groupName, status, clickCount, clicksLast7Days, memberCount, capacity}[] }` |

- `Rotation` = `{id, sessionId, domainId, hostname, slug, publicUrl, status, strategy, title, clickCount, lastClickAt, allFullNotifiedAt, createdAt, updatedAt, groups: Group[]}`
- `Group` = `{id, conversationId, groupJid, groupName, position, weight, capacity, inviteUrl, linkSource, status, memberCount, memberCountAt, clicksSinceSync, clickCount, lastClickAt}`
- Enums: status da rotação `ACTIVE | PAUSED | PAUSED_BY_PLAN`; estratégia `BALANCED | SEQUENTIAL | WEIGHTED | RANDOM`;
  status do grupo `ACTIVE | PAUSED | FULL | NEEDS_LINK | PAUSED_BY_PLAN`; `linkSource` `AUTO | MANUAL | null`.
- Faixas: `capacity` 50–1024 (padrão 1000), `weight` 1–100, slug 3–50 `[a-z0-9-]`.
- `memberCountAt` = última tentativa de leitura (pode ter contagem antiga com horário recente se a leitura falhou).

## Admin — `/api/admin/link-domains` (`authHook`, `superAdminHook`)

| Método | Caminho | Corpo | Resposta |
| --- | --- | --- | --- |
| GET | `/` | — | `{ items: Domain[] }` |
| POST | `/` | `{hostname, landingUrl?, reservedNames?}` | 201 `Domain` |
| PATCH | `/:id` | `{status?, landingUrl?: string\|null, reservedNames?}` | `Domain` |
| DELETE | `/:id` | — | 204 |
| POST | `/:id/probe` | — | `{ok, reason\|null, status\|null, probedAt}` |

`Domain` = `{id, hostname, status, landingUrl, reservedNames, lastProbeAt, lastProbeOk, createdAt, updatedAt}`.
Motivos do probe: `REDIRECT`, `UNEXPECTED_STATUS`, `TIMEOUT`, `NETWORK_ERROR`, `BLOCKED_ADDRESS`, `UNRESOLVABLE`.
Sem super-admin a resposta é **401** `UNAUTHORIZED` (hook compartilhado com `/admin/ai`).

## Erros que o painel traduz

| Código | HTTP | Meta |
| --- | --- | --- |
| `PLAN_LIMIT_REACHED` | 403 | `{key: link_rotations \| link_rotation_groups, limit}` |
| `LINK_SLUG_TAKEN` | 409 | `{suggestions: string[]}` |
| `LINK_SLUG_RESERVED` | 409 | — |
| `LINK_SLUG_INVALID` | 400 | — |
| `LINK_ROTATION_NOT_FOUND` | 404 | — |
| `LINK_GROUP_INVALID` | 400 | — |
| `LINK_INVITE_URL_INVALID` | 400 | — |
| `LINK_DOMAIN_INVALID` | 400 | — |
| `LINK_DOMAIN_TAKEN` | 409 | `{hostname}` |
| `LINK_DOMAIN_IN_USE` | 409 | `{domainId}` |
| `LINK_ROTATION_NOT_CONFIGURED` | 503 | — |
| `GROUP_INVITE_NOT_ALLOWED` | 403 | — |
| `ENGINE_NOT_READY` / `SESSION_NOT_CONNECTED` | — | já existentes |

## Página pública (Host `*.dominio`)
Só `GET /` e `GET /.well-known/link-rotation`. Qualquer outro caminho, inclusive `/health`, é 404 HTML.
Hosts da API e do painel nunca são interceptados, nem com domínio pai cadastrado.
