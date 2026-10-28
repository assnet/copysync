# Estado de autenticação do WhatsApp (auth state) por chave

Status: **implementado (api 0.38.0, 2026-10-27)**; seção 3 descreve o que está no código.

## 1. Problema

O estado Signal/credenciais de cada sessão (`session_auth_states.statePayload`) é **um JSON
único** com todas as chaves (`__creds__`, `pre-key-*`, `session-*`, `sender-key-*`,
`app-state-sync-version-*`…). Qualquer chave que mude regrava o JSON inteiro
(`BaileysAuthStatePersistence.ts`, `flushState` → `upsert`).

Medido em produção (2026-10-27, só leitura):

| Sessão | JSON | Gravado (TOAST comprimido) | Regravações | Maior chave |
|---|---|---|---|---|
| BusinessAdr | 6,0 MB | 3,2 MB | 1.908 | `app-state-sync-version__critical_unblock_low`: 2,0 MB |
| Adriel2 | 1,6 MB | 0,8 MB | 1.392 | idem: 0,3 MB |

Desde o reinício das 20:22: 118 gravações, 241 ms cada, ~720 MB de arquivos temporários, tabela
de 2 linhas com 43 MB (18 versões mortas). Cada reconexão (deploy, queda) dispara a sincronização
do WhatsApp e dezenas de gravações de 3–6 MB em minutos. Foi isso que derrubou o Postgres de
256 MB (OOM às 20:08) e empurra a memória no plano de 1 GB. A fila de envio e o monitoramento não
pesam (claim: 257 execuções, 10 ms no total).

Mitigação já aplicada: `BAILEYS_AUTH_FLUSH_DEBOUNCE_MS` de 2000 → 10000 na Render (agrupa em uma
gravação a cada 10 s; perde no máximo 10 s de chaves numa queda abrupta).

## 2. Alternativas avaliadas

| Alternativa | Veredito | Por quê |
|---|---|---|
| Só aumentar o debounce (feito) | paliativo | Cada gravação continua de 3–6 MB; crescimento da chave de app-state segue linear com contatos/grupos |
| `jsonb_set` só na chave que mudou | não resolve | Postgres regrava a linha inteira (TOAST) de qualquer jeito; mesmo WAL, mesmas tuplas mortas |
| Redis / outro store | não agora | Fora da stack; escala prevê Redis só na Fase 2; estado crítico precisa de durabilidade |
| Desligar app-state sync no Baileys | não | A chave grande é o estado LT-hash dos contatos/chats; sem ela, LID, nomes de grupo e contatos quebram |
| **Uma linha por chave** (`session_auth_keys`) | **escolhida** | É como o próprio Baileys persiste (`useMultiFileAuthState`: um arquivo por chave) e como os adapters Postgres/MySQL da comunidade fazem. Gravação = só as chaves que mudaram (pre-key/session/sender-key têm 1–20 KB); a chave de 2 MB só é regravada quando o app-state muda |
| Complemento: valor comprimido em `bytea` | fase 2, se precisar | `jsonb` já sai ~2× menor pelo TOAST; gzip de base64 chega a ~6×. Só vale se a chave de app-state continuar incomodando após o modelo por chave |

## 3. Desenho

### 3.1 Schema (migration aditiva `create_session_auth_keys`)

```prisma
model SessionAuthKey {
  sessionId String
  key       String      // "__creds__", "pre-key__12", "session__5511…", "app-state-sync-version__critical_unblock_low"
  value     Json        // serializado com BufferJSON (mesmo formato de hoje)
  updatedAt DateTime @updatedAt
  session   Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@id([sessionId, key])
  @@map("session_auth_keys")
}
```

`session_auth_states` fica (coluna `statePayload` passa a ser legado, nullable depois): continua
dona de `tenantId`, `provider`, `version` (lock otimista da Fase 2 da escala, §3.1) e da linha que
`clearCredentials`/`deleteBySessionId` usam.

### 3.2 Persistência (`BaileysAuthStatePersistence.ts`)

- Boot da sessão: `findAllKeys(sessionId)` numa consulta → mapa em memória (como hoje). Se não
  houver linhas e houver `statePayload` legado, **migra**: insere uma linha por chave e zera o blob.
  Lazy, por sessão, sem script offline.
- Leituras (`keys.get`) continuam da memória.
- Escritas: `setStateValue`/`deleteStateValue` marcam a chave num `dirtyKeys: Map<key, value|null>`.
  O flush (debounce atual) grava **só as chaves sujas**: um `createMany … onConflict update` em lote
  + `deleteMany` das removidas, numa transação. Chave que mudou de novo durante o flush em voo
  permanece suja (hoje já há `hasPendingPersist`; passa a ser por chave).
- `serialize` passa a guardar a **string** JSON uma vez (hoje faz `stringify` para serializar e de
  novo para comparar; na chave de 2 MB isso é CPU no event loop a cada `set`).
- **`keys.set`/`saveCreds` não esperam o flush.** Antes devolviam a promessa do flush
  (debounce + gravação): o Baileys chama `keys.set` ao descriptografar cada mensagem, então cada
  mensagem esperava o debounce inteiro (até 10 s com o valor atual da Render). Agora o agendamento
  é imediato; erro de gravação é logado e as chaves voltam a sujas para o próximo flush.
- `forceFlush`/`dispose`/`flushAllAuthStates` inalterados por fora. `forceFlush` com flush em voo
  espera-o (o laço drena o que sujar) e grava o resto.
- Contrato: `ISessionAuthStateRepository` ganha `findAllKeys(sessionId)` e `writeKeys({ sessionId,
  tenantId, provider, upserts, deletes })` (transação com a linha-mãe, timeout 30 s);
  `clearCredentials` e `deleteBySessionId` apagam também `session_auth_keys`.
- **Um handle vivo por sessão** (`activeHandles`): `buildBaileysAuthState` grava o pendente do
  handle anterior e o descarta ANTES de ler o banco (reconexão não perde nem regrava chave velha);
  handle descartado nunca mais escreve. O adapter chama `releaseAuthState` (grava e solta) na
  desconexão e `discardAuthState` (joga fora o pendente) no logout e na credencial revogada, antes
  de `clearCredentials`: sem isso um flush atrasado ressuscitava credenciais após o logout.
- Falha de gravação esgotando as tentativas: chaves voltam a sujas e o flush **rearma sozinho**
  (backoff de 5× o retry, 1–30 s); sessão quieta não fica só em memória.
- Comparação de valor igual usa texto canônico (chaves ordenadas): o `jsonb` reordena as chaves e,
  sem isso, o primeiro `set` após reboot regravaria tudo (inclusive a chave de 2 MB).

### 3.3 Rollout

1. Migration cria a tabela (vazia). Código antigo ignora a tabela: compatível durante o deploy.
2. Deploy: cada sessão migra no boot (uma leitura do blob + um insert em lote por sessão).
3. Rollback possível enquanto o blob existir: código antigo lê `statePayload`. Como o novo zera o
   blob ao migrar, o rollback exige reconectar a sessão por QR. Alternativa segura: **não zerar** o
   blob na migração e só parar de atualizá-lo; zerar numa migration posterior (`drop column`) após
   uma semana estável. Escolha: a segunda. **Rollback** = voltar o código: ele lê o blob, que ficou
   como estava no momento da migração (chaves gravadas depois disso se perdem; sessão pode pedir QR).
   **Voltar de novo para o código novo depois de um rollback** exige apagar `session_auth_keys`
   dessas sessões (senão a tabela, mais velha que o blob, vence: pre-keys já consumidas reaparecem).
4. Medido em Postgres local: migração de um blob com chave de 2 MB em 36 ms; flush de uma
   mensagem (1 upsert + 1 delete) em 11 ms sem tocar a chave de 2 MB; 500 chaves de sync em 13 ms.

### 3.4 Efeito esperado

- Gravação típica (mensagem recebida/enviada): de 3–6 MB para 1–50 KB.
- Reconexão: a chave de app-state (2 MB) sai no máximo a cada debounce, e só se mudou.
- Tuplas mortas e WAL proporcionais ao que mudou; autovacuum dá conta.

## 4. Verificação

- Testes de unidade do adapter com repositório em memória: get/set/delete, flush só de chaves
  sujas, chave suja durante flush em voo, migração do blob legado, `clearCredentials`.
- Postgres local descartável: migration, migração lazy de um blob real (export anonimizado de
  teste), `writeKeys` em lote, cascade no delete.
- Produção após deploy: `pg_stat_statements` (gravações de `session_auth_keys` com `mean_exec_time`
  de ms, não centenas), tamanho de `session_auth_states` parado, memória do Postgres estável
  após uma reconexão forçada.

## 4.1 Validado

- Unidade (`BaileysAuthStatePersistence.test.ts`, 10 casos): só chaves alteradas, valor igual não
  grava, delete, Buffer ida e volta, reboot lê da tabela, migração do blob (sem zerar; não repete),
  chave suja durante flush em voo, falha esgotando retries devolve as chaves a sujas, retry, debounce.
- Ciclo de vida (mesmo arquivo, 5 casos): reconexão grava o pendente do handle antigo e o antigo
  não escreve mais; `discardAuthState` + `clearCredentials` sem ressurreição; `releaseAuthState`;
  valor idêntico após reboot com chaves reordenadas não grava; rearme após falha pelo timer.
- Postgres local descartável, script manual (não está no repo) com o
  `PrismaSessionAuthStateRepository` real: migração de blob com chave de 2 MB, `ON CONFLICT`,
  lote de 500, `clearCredentials`, `deleteBySessionId`.

## 5. Esforço

| Passo | Esforço |
|---|---|
| Migration + model + repositório + contrato | 0,5 dia |
| Adapter por chave + migração lazy + testes | 1 dia |
| Validação em Postgres local + CHANGELOG + docs | 0,5 dia |

Total ≈ 2 dias. Versão: api minor (0.38.0).

## 6. O que não fazer

- Gravar o mapa inteiro "por garantia" em qualquer caminho (é o problema atual).
- Zerar o blob legado no mesmo deploy que começa a usar a tabela nova (perde o rollback).
- Reduzir o debounce de volta sem o modelo por chave.
- Rodar a migração lazy fora do boot da sessão (ex.: script com `api/.env` = produção).
