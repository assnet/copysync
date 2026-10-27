# Armazenamento de mídia — Cloudflare R2

Guia completo de configuração, operação e manutenção do armazenamento de mídia em object
storage S3-compatível (Cloudflare R2). Complementa
[`chat-midias-anexos.md`](chat-midias-anexos.md) (fluxo de upload/download) e
[`arquitetura-escala.md`](arquitetura-escala.md) (seção 3.5, papel do R2 na escala).

Atualizado em 2026-10-26.

---

## 1. Visão geral

### O que é Cloudflare R2

Cloudflare R2 é um serviço de armazenamento de objetos com API 100% compatível com o protocolo
S3 da AWS. A principal vantagem competitiva é **zero custo de egresso** (transferência de
saída): não importa quantos bytes os usuários baixam, o custo é sempre zero. Em contraste, o
AWS S3 cobra $0.09/GB de egresso, o que em plataformas de mensageria (onde mídia é baixada
repetidamente) pode superar o custo do armazenamento em si.

### Por que R2 e não S3/MinIO/GCS

| Critério | Cloudflare R2 | AWS S3 | MinIO (self-hosted) |
|---|---|---|---|
| Egresso | **$0** | $0.09/GB | $0 (tráfego do servidor) |
| Free tier | 10 GB + 10M reads + 1M writes/mês | 5 GB (12 meses) | ilimitado |
| Compatibilidade S3 | total | nativo | total |
| Setup | dashboard web, 5 min | IAM + policies | docker-compose |
| CDN integrado | sim (Cloudflare) | CloudFront (extra) | proxy reverso manual |
| Latência de escrita | boa (edge caching) | boa (região escolhida) | depende do servidor |

Decisão: **R2 para produção na Render** (sem MinIO porque a Render não tem disco persistente
dedicado para MinIO). Self-hosted pode usar MinIO atrás da mesma interface — basta trocar as
variáveis de ambiente.

### Como funciona na arquitetura

```
┌─────────────┐     ┌──────────────────────┐     ┌────────────────┐
│  Painel web │ ──► │  API (Fastify)       │ ──► │  Cloudflare R2 │
│  (React)    │     │                      │     │  (bucket)      │
│             │ ◄── │  IMediaFileStore      │ ◄── │                │
│  <img src=  │     │   ├ LocalMediaFileStore│    │  media/        │
│   "R2 URL"> │     │   └ S3MediaFileStore  │    │   ├ sid_id.jpg  │
└─────────────┘     └──────────────────────┘     │   ├ sid_id.mp4  │
                                                  │   └ ...         │
                                                  └────────────────┘
```

- **Contrato**: `api/src/modules/media/domain/contracts/IMediaFileStore.ts`
- **Implementação S3**: `api/src/modules/media/infrastructure/storage/S3MediaFileStore.ts`
- **Implementação local**: `api/src/modules/media/infrastructure/storage/LocalMediaFileStore.ts`
- **Swap point**: `api/src/modules/media/infrastructure/mediaContainer.ts` — escolhe a
  implementação com base em `env.S3_ENABLED`

O frontend **nunca** fala com o R2 diretamente. O upload vai para a API (chunked, como antes),
a API promove o arquivo montado para o R2 e devolve a URL pública. O frontend usa essa URL
diretamente em `<img>`, `<audio>`, `<video>`.

---

## 2. Pré-requisitos

1. **Conta Cloudflare** — gratuita em [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. **Cartão de crédito** — necessário para ativar o R2 (cobrado somente acima do free tier)
3. **Domínio no Cloudflare** (opcional) — para URL pública personalizada (`media.copysync.app`)

> ⚠️ A conta Cloudflare é da **plataforma**, não dos usuários finais. Os tenants e seus
> contatos nunca veem nem precisam de credenciais Cloudflare.

---

## 3. Passo a passo: criação do bucket

### 3.1 Acessar o painel R2

1. Faça login em [dash.cloudflare.com](https://dash.cloudflare.com)
2. No menu lateral esquerdo, clique em **R2 Object Storage**
3. Se for a primeira vez, clique em **Enable R2** (aceita os termos e cadastra o cartão)

### 3.2 Criar o bucket

1. Clique em **Create bucket**
2. Nome: `copysync-media`
   - O nome é global e imutável após criação
   - Use apenas letras minúsculas, números e hífens
3. Região: **Automatic** (Cloudflare escolhe a edge mais próxima)
   - Para garantir proximidade com a Render (Virginia), selecione **Eastern North America**
     se disponível
4. Clique em **Create bucket**

### 3.3 Habilitar acesso público

> Necessário para que o frontend consiga carregar as mídias diretamente pela URL.

1. Dentro do bucket `copysync-media`, vá em **Settings**
2. Na seção **Public access**, clique em **Allow Access**
3. Confirme clicando em **Allow**

Após habilitar, o R2 gera uma URL pública no formato:
```
https://pub-<hash>.r2.dev
```

Essa URL é funcional, mas não é personalizada. Recomendamos configurar um domínio customizado.

### 3.4 Domínio customizado (recomendado)

> Opcional, mas melhora a experiência e permite trocar de provedor sem mudar URLs no banco.

1. Ainda em **Settings** do bucket, na seção **Custom Domains**, clique em **Connect Domain**
2. Digite: `media.copysync.app`
3. O Cloudflare configura o CNAME automaticamente (o domínio precisa estar no Cloudflare DNS)
4. Aguarde a propagação (geralmente < 5 min)
5. Teste: acesse `https://media.copysync.app` — deve retornar `<Error><Code>NoSuchKey</Code>...`
   (esperado: o bucket está vazio)

### 3.5 Configuração de CORS

> Necessário para que o painel (`copysync.app`) consiga fazer requisições GET às mídias.

1. Em **Settings** do bucket, na seção **CORS Policy**, clique em **Edit CORS policy**
2. Cole a seguinte configuração JSON:

```json
[
  {
    "AllowedOrigins": [
      "https://copysync.app",
      "https://app.copysync.app",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

3. Clique em **Save**

> **Nota:** inclua `http://localhost:5173` para desenvolvimento local com Vite. Remova em
> ambientes que não tenham painel de dev.

---

### 3.6 CSP do painel (obrigatório)

O painel só carrega áudio, vídeo e `fetch` de origens listadas no `Content-Security-Policy`
(`render.yaml` → `copysync_app`). A origem de `S3_PUBLIC_URL` precisa estar em **`media-src` e
`connect-src`**; sem isso só a imagem aparece (`img-src` aceita qualquer `https:`). Liberadas hoje:
`https://pub-38f8c0e80d0e437f97881e64c0f408bb.r2.dev` e `https://media.copysync.app`. Ao trocar o
domínio público, atualizar o CSP no mesmo deploy (ver `docs/app-bloqueio-indexacao.md`).

## 4. Passo a passo: API Token

### 4.1 Copiar o Account ID

1. No painel Cloudflare, clique no ícone de engrenagem no canto superior direito
2. Em **API** → **Account ID**, copie o valor (string hexadecimal de 32 caracteres)
3. O endpoint S3 é montado a partir dele:
   ```
   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

### 4.2 Criar o token de API

1. Em **R2 Object Storage**, clique em **Manage R2 API Tokens** (barra lateral ou canto
   superior)
2. Clique em **Create API token**
3. Configure:
   - **Token name**: `copysync-api-media` (qualquer nome descritivo)
   - **Permissions**: **Object Read & Write**
   - **Specify bucket(s)**: selecione **Apply to specific buckets only** → `copysync-media`
   - **TTL**: deixe vazio (sem expiração) ou defina conforme política de rotação
4. Clique em **Create API Token**
5. **Copie imediatamente** os três valores exibidos:
   - **Access Key ID** (ex.: `a1b2c3d4e5f6g7h8i9j0...`)
   - **Secret Access Key** (ex.: `AbCdEfGh...`)
   - **Endpoint URL (S3 API)** — confirme que bate com
     `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

> ⚠️ O Secret Access Key **só é exibido uma vez**. Se perder, delete o token e crie outro.

---

## 5. Configuração no ambiente

### 5.1 Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `MEDIA_STORAGE_DRIVER` | não | `local` | `local` (disco) ou `s3` (R2/S3-compatível) |
| `S3_ENDPOINT` | sim (se `s3`) | — | URL do endpoint S3: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | sim (se `s3`) | — | Nome do bucket: `copysync-media` |
| `S3_REGION` | não | `auto` | Região S3. Para R2, sempre `auto` |
| `S3_ACCESS_KEY_ID` | sim (se `s3`) | — | Access Key ID do token R2 |
| `S3_SECRET_ACCESS_KEY` | sim (se `s3`) | — | Secret Access Key do token R2 |
| `S3_PUBLIC_URL` | não | endpoint | URL pública do bucket. Com domínio customizado: `https://media.copysync.app`. Sem: `https://pub-<hash>.r2.dev` |

A variável derivada `S3_ENABLED` é calculada automaticamente:
```
S3_ENABLED = MEDIA_STORAGE_DRIVER === 's3'
             && S3_ENDPOINT
             && S3_BUCKET
             && S3_ACCESS_KEY_ID
             && S3_SECRET_ACCESS_KEY
```

Se `MEDIA_STORAGE_DRIVER=s3` mas faltar alguma credencial, a API **sobe normalmente em modo
local** (fallback silencioso não existe — o boot loga erro e a mídia falha).

### 5.2 Exemplo completo

```env
# ── Object storage (Cloudflare R2) ──────────────────────────────
MEDIA_STORAGE_DRIVER=s3
S3_ENDPOINT=https://a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.r2.cloudflarestorage.com
S3_BUCKET=copysync-media
S3_REGION=auto
S3_ACCESS_KEY_ID=a1b2c3d4e5f6g7h8i9j0
S3_SECRET_ACCESS_KEY=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd
S3_PUBLIC_URL=https://media.copysync.app
```

### 5.3 Onde configurar

#### Render (produção)

1. Acesse o serviço `copysync_api` no painel da Render
2. Vá em **Environment** → **Environment Variables**
3. Adicione cada variável individualmente (ou use o botão **Add from .env**)
4. Clique em **Save Changes** — o serviço reinicia automaticamente

#### Desenvolvimento local

Crie ou edite `api/.env.local` (arquivo já no `.gitignore`):

```env
MEDIA_STORAGE_DRIVER=s3
S3_ENDPOINT=https://a1b2c3d4...r2.cloudflarestorage.com
S3_BUCKET=copysync-media-dev
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://pub-abc123.r2.dev
```

> **Recomendação:** use um bucket separado para desenvolvimento (`copysync-media-dev`) para
> não misturar mídias de teste com produção.

> ⚠️ **Nunca** commite credenciais S3. O `api/.env.local` está no `.gitignore`. Se precisar
> compartilhar credenciais de dev com a equipe, use um gerenciador de segredos (macOS Keychain,
> 1Password, Doppler, etc.).

---

## 6. Migração de mídia existente

### 6.1 Comportamento durante a transição

Ao ativar `MEDIA_STORAGE_DRIVER=s3`:

- **Mídia nova** (upload do painel + download de mensagens recebidas) vai para o R2
  automaticamente. URLs no formato: `https://media.copysync.app/media/{filename}`
- **Mídia antiga** (já no disco e referenciada no banco como `/api/storage/media/{filename}`)
  continua sendo servida pelo `@fastify/static` normalmente. O disco local precisa continuar
  existindo enquanto houver URLs antigas no banco
- **Nenhuma mudança no banco** é necessária para a transição. O campo `mediaUrl` nos registros
  de `ChatMessage` simplesmente terá dois formatos coexistindo

### 6.2 Padrão de URLs

| Origem | Formato da URL | Servido por |
|---|---|---|
| Disco (antes do R2) | `/api/storage/media/sid_msgid.jpg` | `@fastify/static` (API) |
| R2 (após ativação) | `https://media.copysync.app/media/sid_msgid.jpg` | Cloudflare (direto) |

O frontend não precisa de nenhuma alteração — ambos os formatos funcionam como `src` de
`<img>`, `<audio>`, `<video>`.

### 6.3 Migração em lote (opcional)

Para eliminar a dependência do disco local (necessário para réplicas > 1 na Render), migre as
mídias existentes com `rclone` ou a CLI `aws`:

#### Opção A: rclone

```bash
# Instalar rclone
brew install rclone  # macOS
# ou: curl https://rclone.org/install.sh | sudo bash

# Configurar remote R2
rclone config
# → New remote → nome: r2
# → Storage: s3
# → Provider: Cloudflare
# → access_key_id: <Access Key ID>
# → secret_access_key: <Secret Access Key>
# → endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# → Demais: Enter (padrão)

# Copiar mídia do disco para R2
rclone copy /var/data/storage/media/ r2:copysync-media/media/ \
  --progress \
  --transfers 8 \
  --checkers 16
```

#### Opção B: AWS CLI

```bash
# Instalar aws-cli
brew install awscli  # macOS

# Configurar
export AWS_ACCESS_KEY_ID=<Access Key ID>
export AWS_SECRET_ACCESS_KEY=<Secret Access Key>
export AWS_DEFAULT_REGION=auto

# Copiar
aws s3 sync /var/data/storage/media/ \
  s3://copysync-media/media/ \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

#### Atualizar URLs no banco (após migração)

Após confirmar que todas as mídias estão no R2, atualize as URLs no banco para apontar
diretamente ao R2:

```sql
-- ⚠️ EXECUTE APENAS APÓS CONFIRMAR QUE TODAS AS MÍDIAS ESTÃO NO R2
-- ⚠️ FAÇA BACKUP DO BANCO ANTES
-- ⚠️ Teste com SELECT antes de UPDATE

-- Verificar quantos registros serão afetados:
SELECT COUNT(*) FROM "ChatMessage"
WHERE "mediaUrl" LIKE '/api/storage/media/%';

-- Atualizar (substitua o domínio conforme sua configuração):
UPDATE "ChatMessage"
SET "mediaUrl" = REPLACE("mediaUrl", '/api/storage/media/', 'https://media.copysync.app/media/')
WHERE "mediaUrl" LIKE '/api/storage/media/%';
```

Após a migração completa, o disco local pode ser removido (exceto a pasta de uploads
temporários, que continua em disco até a implementação de multipart upload S3).

---

## 7. Verificação

### 7.1 Checklist pós-configuração

1. **Logs de boot** — procure a mensagem de inicialização do módulo de mídia:
   ```
   Media file store: S3/R2  {"driver":"s3","bucket":"copysync-media"}
   ```
   Se aparecer `Media file store: local disk`, as credenciais estão faltando ou inválidas.

2. **Upload de teste** — no painel, envie uma imagem em uma conversa. Após o envio:
   - A mensagem deve mostrar a imagem carregada
   - Inspecione o elemento da imagem no navegador (F12 → Elements): o `src` deve ser uma URL
     R2, não `/api/storage/media/...`

3. **R2 Dashboard** — no painel Cloudflare, acesse o bucket `copysync-media`:
   - Deve aparecer a pasta `media/` com o arquivo enviado
   - O nome segue o padrão `{sessionId}_{externalMessageId}.{ext}`

4. **Download de mídia recebida** — envie uma foto pelo WhatsApp para uma sessão conectada.
   Verifique que a mídia aparece no painel e que a URL é do R2.

5. **Reenvio de mídia** — se uma mídia falhar (`FAILED`), clique em "Tentar novamente". O
   `acquireLocalFile` baixa temporariamente do R2 para enviar ao WhatsApp, depois limpa o
   temporário.

### 7.2 Teste de conectividade via CLI

```bash
# Na máquina que roda a API (ou localmente com as mesmas credenciais)
aws s3 ls s3://copysync-media/ \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com

# Upload de teste
echo "test" > /tmp/test-r2.txt
aws s3 cp /tmp/test-r2.txt s3://copysync-media/test-r2.txt \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com

# Verificar acesso público
curl -I https://media.copysync.app/test-r2.txt
# Deve retornar 200 OK

# Limpar
aws s3 rm s3://copysync-media/test-r2.txt \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

---

## 8. Custos e limites

### 8.1 Free tier (permanente, sem prazo)

| Recurso | Limite gratuito |
|---|---|
| Armazenamento | 10 GB/mês |
| Operações Classe A (PUT, POST, LIST) | 1.000.000/mês |
| Operações Classe B (GET, HEAD) | 10.000.000/mês |
| Egresso (transferência de saída) | **ilimitado e gratuito** |

### 8.2 Acima do free tier

| Recurso | Preço |
|---|---|
| Armazenamento | $0.015/GB/mês |
| Operações Classe A | $4.50 por milhão |
| Operações Classe B | $0.36 por milhão |
| Egresso | **$0** |

### 8.3 Estimativas por cenário

| Cenário | Armazenamento | Writes/mês | Reads/mês | Custo estimado |
|---|---|---|---|---|
| 10 tenants, uso leve | < 1 GB | < 10K | < 100K | **$0** (free tier) |
| 50 tenants, uso moderado | ~5 GB | ~50K | ~500K | **$0** (free tier) |
| 200 tenants, uso ativo | ~30 GB | ~200K | ~5M | **~$0.30/mês** |
| 1.000 tenants, escala | ~200 GB | ~1M | ~30M | **~$3.80/mês** |

> Para comparação, o mesmo cenário de 1.000 tenants no AWS S3 custaria **~$20-50/mês** só de
> egresso, além do armazenamento e operações.

### 8.4 Limites técnicos

| Limite | Valor |
|---|---|
| Tamanho máximo por objeto | 5 TB (via multipart upload) |
| Tamanho máximo por PUT simples | 5 GB |
| Tamanho mínimo de parte (multipart) | 5 MB (exceto última) |
| Número máximo de partes | 10.000 |
| Buckets por conta | 1.000 |
| Objetos por bucket | ilimitado |
| Metadados customizados por objeto | 2 KB |

---

## 9. Troubleshooting

### 9.1 Erros comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `AccessDenied` / 403 no upload | Token sem permissão de escrita no bucket | Recriar token com **Object Read & Write** para o bucket correto |
| `NoSuchBucket` | Nome do bucket errado em `S3_BUCKET` | Verificar no dashboard R2 o nome exato |
| `InvalidAccessKeyId` | `S3_ACCESS_KEY_ID` incorreto ou token deletado | Verificar no dashboard R2; recriar token se necessário |
| `SignatureDoesNotMatch` | `S3_SECRET_ACCESS_KEY` incorreto | Recriar token e copiar a chave novamente |
| CORS bloqueando no navegador | Política CORS ausente ou origem errada | Adicionar a origem do painel na política CORS do bucket (seção 3.5) |
| Imagem não carrega (404) | Acesso público não habilitado | Habilitar em Settings → Public access (seção 3.3) |
| `Media file store: local disk` no log | Credenciais faltando | Verificar se **todas** as 5 vars obrigatórias estão configuradas |
| Upload OK mas URL retorna 404 | `S3_PUBLIC_URL` aponta para endpoint errado | Verificar se aponta para a URL pública (com domínio customizado ou `pub-*.r2.dev`), não para o endpoint S3 API |

### 9.2 Verificar conectividade

```bash
# No container/servidor da API
node -e "
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const c = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
c.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, MaxKeys: 1 }))
  .then(r => console.log('OK — objetos:', r.KeyCount))
  .catch(e => console.error('ERRO:', e.name, e.message));
"
```

### 9.3 Rollback para disco local

Se algo der errado, reverter é imediato:

1. Altere `MEDIA_STORAGE_DRIVER=local` no ambiente (ou remova a variável)
2. Reinicie a API
3. Mídias novas voltam a ser salvas em disco
4. Mídias que já foram salvas no R2 continuam acessíveis pelo frontend (URL absoluta)

> **Importante:** o rollback não migra mídias do R2 de volta para o disco. Elas permanecem
> acessíveis pela URL do R2, mas novas mídias vão para disco.

---

## 10. O que NÃO fazer

| ❌ Proibido | Por quê |
|---|---|
| Expor `S3_SECRET_ACCESS_KEY` no frontend, logs ou git | Dá acesso total de escrita/leitura ao bucket; qualquer pessoa pode apagar toda a mídia |
| Deletar o bucket sem migrar URLs no banco | Todas as `mediaUrl` que apontam para o R2 param de funcionar; mensagens perdem mídia permanentemente |
| Trocar nome do bucket sem atualizar `S3_BUCKET` e `S3_PUBLIC_URL` | Mesmo efeito: URLs quebram |
| Usar `db push` para alterar a coluna `mediaUrl` | Pode apagar dados; usar `prisma migrate dev --name descricao` |
| Criar token com permissão em **todos** os buckets | Princípio do menor privilégio: restrinja ao bucket `copysync-media` |
| Usar o mesmo bucket para dev e produção | Teste pode sobrescrever mídia real; crie `copysync-media-dev` |
| Desabilitar acesso público e esquecer de atualizar `S3_PUBLIC_URL` | Frontend recebe 403 em todas as mídias |
| Fazer upload direto do browser para o R2 (presigned URL) | O upload deve passar pela API para manter autenticação, validação e controle de tenant |

---

## 11. Operações de manutenção

### 11.1 Rotação de credenciais

1. No painel R2, crie um **novo** token com as mesmas permissões
2. Atualize `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` no ambiente da Render
3. A API reinicia e usa as novas credenciais
4. Confirme que upload e download funcionam
5. Delete o token antigo no painel R2

> **Zero downtime:** a Render sobe a nova instância com as novas credenciais antes de matar a
> antiga. Não há janela de indisponibilidade.

### 11.2 Monitoramento de uso

No painel R2, a aba **Metrics** do bucket mostra:
- Armazenamento total
- Operações de leitura/escrita (por dia/semana/mês)
- Objetos totais

### 11.3 Limpeza de mídia órfã

Mídias de sessões excluídas ou tenants removidos ficam no bucket sem referência no banco.
Futuro: job de garbage collection que lista objetos no R2, cruza com `ChatMessage.mediaUrl` e
remove os órfãos. Por ora, o custo de armazenamento é baixo o suficiente para não justificar a
complexidade.

### 11.4 Backup

O R2 não tem backup nativo. Opções:

1. **rclone sync** para outro bucket R2 ou S3 (cron diário)
2. **Cloudflare R2 Sippy** — replicação automática de/para S3 (beta)
3. **Na prática:** a mídia pode ser regenerada (o WhatsApp guarda por 30 dias; o upload pode
   ser refeito pelo painel). O backup do **banco de dados** é mais crítico que o da mídia

---

## 12. Evolução futura

| Item | Descrição | Status |
|---|---|---|
| Multipart upload S3 | Upload em partes direto para o R2, eliminando disco temporário | planejado (E2) |
| CDN com cache rules | Regras de cache por tipo de arquivo no Cloudflare | após domínio customizado |
| Lifecycle rules | Mover mídia > 90 dias para Infrequent Access (se R2 suportar) | monitorar roadmap do R2 |
| Presigned URLs (privado) | Bucket privado + URLs assinadas com TTL | se necessário por compliance |
| MinIO para self-hosted | Mesma interface, zero custo, atrás de Dokploy/Coolify | planejado para self-hosted |

---

## 13. Referências

### Documentação interna

- [`chat-midias-anexos.md`](chat-midias-anexos.md) — fluxo completo de upload, download, classificação e envio de mídia
- [`arquitetura-escala.md`](arquitetura-escala.md) — seção 3.5 (mídia em objeto) e Fase 1 da ordem de entrega
- [`produto-roadmap.md`](produto-roadmap.md) — itens E1-E4 (escala)
- Contrato: `api/src/modules/media/domain/contracts/IMediaFileStore.ts`
- Implementação S3: `api/src/modules/media/infrastructure/storage/S3MediaFileStore.ts`
- Implementação local: `api/src/modules/media/infrastructure/storage/LocalMediaFileStore.ts`
- Swap point: `api/src/modules/media/infrastructure/mediaContainer.ts`
- Variáveis de ambiente: `api/src/shared/config/env.ts` (seção `Object storage`)

### Documentação externa

- [Cloudflare R2 — Documentação oficial](https://developers.cloudflare.com/r2/)
- [R2 — Preços](https://developers.cloudflare.com/r2/pricing/)
- [R2 — S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/)
- [R2 — Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 — CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [R2 — Custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/#custom-domains)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [rclone — Cloudflare R2](https://rclone.org/s3/#cloudflare-r2)
