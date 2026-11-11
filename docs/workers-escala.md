# Gestão de escala dos workers

Super admin ajusta o teto de sessões por worker e os limiares de alerta pelo painel, sem redeploy.
Spec: [`.specs/features/worker-scaling/`](../.specs/features/worker-scaling/spec.md) (WSCALE-01..07, 19). Arquitetura:
[`arquitetura-escala.md`](arquitetura-escala.md) §3.2. Feito na P1 (api 0.82.0 · app 0.101.0); capacidade, escalador e
subida automática (P2–P4) ainda não existem.

## Onde fica

- Valor: `platform_settings`, chave `worker_scaling` (JSON). Sem tabela própria, um valor para todas as réplicas (D1).
- Domínio: `sessions/domain/services/workerScalingSettings.ts` (faixas, defaults, `resolveEffectiveSettings`).
- Provider: `RefreshingWorkerScalingSettingsProvider` via `workerScalingSettingsProvider()` (`sessionLeaseContainer.ts`),
  singleton em todo papel; `server.ts` faz `refresh()` + `start()` no boot e `stop()` no shutdown.
- Rotas (super admin): `GET`/`PUT /admin/workers/settings`. Tela: aba **Configuração** em `/admin/workers/settings`.

## Campos e faixas

| Campo | Faixa | Default sem linha salva |
|---|---|---|
| `maxSessionsPerWorker` | 1–1000 | `WORKER_MAX_SESSIONS` (40) |
| `maxPendingLoginsPerWorker` | 1–500 | `WORKER_MAX_PENDING_LOGINS` (50) |
| `alertOccupancyRatio` | 0,5–0,95 | 0,8 |
| `awaitingAlertSeconds` | 30–3600 | 120 |
| `scalerMode` | `off`\|`manual`\|`auto` | `off` |
| `minReplicas` / `maxReplicas` | 1–20, `max ≥ min` | 1 / 1 |
| `scaleUpSustainSeconds` | 300–3600 | 900 |
| `scaleCooldownSeconds` | 300–86400 | 1800 |

Inteiros exceto o ratio; sem coerção de string. Campo desconhecido, tipo errado ou fora da faixa → 400
`INVALID_WORKER_SCALING_SETTINGS` com `meta.field`. `PUT` exige o objeto completo. `scalerMode` e réplicas só ficam
guardados na P1 (escalador é P3/P4).

## De onde vem o valor

- Sem linha salva: o default acima (comportamento de antes). `WORKER_MAX_*` viram **só valor inicial** (D2), lidos
  apenas em `workerScalingEnvDefaults()` (`shared/config/workerAdoption.ts`).
- Salvo, o banco vence a env campo a campo. A resposta traz `origin[campo] = default|saved`.
- Provider: `current()` síncrono; refresh a cada 30 s (`unref`) e na hora no processo que salvou.
- Linha salva inválida: `GET` e provider usam o default da env (origem `default`) e logam `warn` uma vez, sem o conteúdo.
- Erro de leitura do banco: o provider mantém o último valor bom. Boot com leitura lenta espera no máximo 5 s e segue
  com a env.
- Env acima da faixa (`WORKER_MAX_SESSIONS` > 1000, `WORKER_MAX_PENDING_LOGINS` > 500) é limitada ao teto, com aviso no log.
- Mudança vale em todas as réplicas em até 30 s, sem reinício.

## Efeito

- Consumidores leem o provider **a cada uso**: gate do lease (`CapacityLimitedLeaseGate` recebe função), ticker de
  adoção, fila `session-open` (`roleComposition.ts`), `WorkerHeartbeatJob` (teto gravado) e `WorkerCapacityAlertJob`
  (ratio e segundos).
- `enforced` = adoção ligada no processo (`WORKER_ADOPTION_ENABLED`) **ou** batimento vivo de algum worker. **Limite conhecido:** sem adoção o gate com teto nem é criado e não há heartbeat;
  a configuração só é guardada e mostrada (faixa "sem efeito" na tela). Vale quando a adoção for ligada (D12).
- Reduzir o teto abaixo das sessões atuais **não derruba** sessão: o worker só para de adotar (ocupação > 100%). Aumentar
  libera vaga no próximo tick (D3).

## Gravação

- `PUT` com `expectedUpdatedAt` (o `updatedAt` do `GET`; `null` sem linha). Outro admin salvou antes → 409
  `WORKER_SCALING_SETTINGS_CONFLICT`; a tela recarrega e descarta o rascunho.
- Grava `updatedById` e auditoria `WORKER_SCALING_SETTINGS_CHANGED` com `before`/`after` (migration
  `20261111140000_add_audit_action_worker_scaling`, que também cria `WORKER_SCALE_REQUESTED` para a P3).
- Tela: confirmação com o diff; mudar o teto pede digitar o valor novo (sem medição de RAM na P1, regra "não subir o teto
  sem medir", `arquitetura-escala.md` §6); aviso se o teto fica abaixo da ocupação atual; rascunho em `usePersistedState`
  (`workers.settings.draft`, escopo `tab`), limpo ao salvar.

Sem flag de privacidade: a tela só mostra números da plataforma, nenhum dado de cliente, grupo ou produto.

## O que não fazer

- Ler `WORKER_MAX_SESSIONS`/`WORKER_MAX_PENDING_LOGINS` (ou `env.WORKER_MAX_*`) em código novo: use `current().value`.
- Guardar o número do provider em construtor, campo ou closure criada fora da função que checa: passe a função
  (`() => provider.current().value`) e leia no uso.
- Fazer I/O no construtor do provider ou criar outra instância: só `workerScalingSettingsProvider()`.
- Aplicar o teto sem adoção ou derrubar sessão acima do teto novo.
- Gravar `worker_scaling` direto no banco (sem auditoria nem validação); linha inválida cai no default da env (não no último valor salvo).
- Teto por instância: `workerId` muda a cada boot.
