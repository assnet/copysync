# Database Migration Instructions

## Objetivo

Este documento descreve o processo completo para:

1. criar um novo banco dentro de uma instancia PostgreSQL ja existente na Render;
2. exportar o banco local usado pelo projeto no Docker;
3. importar esse dump para o novo banco remoto na Render;
4. apontar a API do WaioPrime para o banco remoto;
5. validar se a migracao terminou corretamente.

O foco deste guia e o cenario atual do projeto:

- banco local rodando via Docker Compose;
- container local do PostgreSQL chamado `waioprime_postgres`;
- banco local chamado `waioprime`;
- usuario local chamado `waioprime`;
- API usando Prisma com `DATABASE_URL`.

## Quando usar URL interna ou externa da Render

Use a URL interna da Render somente quando a API e o PostgreSQL estiverem:

- na mesma conta/workspace da Render;
- na mesma regiao.

Se a API estiver em outra conta, outro workspace ou fora da mesma regiao, use a URL externa.

Para conexao externa com PostgreSQL da Render, use `sslmode=require`.

## Pre-requisitos

Antes de comecar, confirme que voce tem:

- acesso ao dashboard da Render;
- host, usuario, senha e nome do banco principal da instancia PostgreSQL da Render;
- Docker disponivel localmente;
- o banco local do projeto rodando no Docker.

## 1. Subir o banco local, se necessario

Se o ambiente local ainda nao estiver ativo:

```bash
cd /Users/adrielss/www/waioprime
docker compose up -d postgres
```

Para confirmar o container:

```bash
docker ps --filter name=waioprime_postgres
```

## 2. Criar um novo banco dentro da instancia PostgreSQL da Render

Como o `psql` local nao esta instalado, este projeto usa o cliente do PostgreSQL via Docker.

Abra uma conexao com o banco principal da instancia da Render:

```bash
docker run --rm -it \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=<RENDER_EXISTING_DB> user=<RENDER_USER> sslmode=require"
```

Exemplo de valores esperados:

- `RENDER_HOST`: host `dpg-...render.com`;
- `RENDER_EXISTING_DB`: banco atual da instancia, usado apenas para conectar;
- `RENDER_USER`: usuario da instancia;
- `RENDER_PASSWORD`: senha da instancia.

Dentro do prompt do PostgreSQL, crie o novo banco:

```sql
CREATE DATABASE waioprime;
```

Se o retorno for `CREATE DATABASE`, o banco foi criado com sucesso.

## 3. Validar que o banco remoto foi criado

Evite depender de `\l` quando houver incompatibilidade entre a versao do cliente e a versao do servidor.

No lugar disso, rode SQL puro:

```sql
SELECT datname FROM pg_database ORDER BY datname;
```

Ou em modo nao interativo:

```bash
docker run --rm -it \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=<RENDER_EXISTING_DB> user=<RENDER_USER> sslmode=require" \
  -c "SELECT datname FROM pg_database ORDER BY datname;"
```

## 4. Gerar o dump do banco local

Exporte estrutura e dados do banco local para um arquivo SQL:

```bash
cd /Users/adrielss/www/waioprime
docker exec -i waioprime_postgres pg_dump \
  -U waioprime \
  -d waioprime \
  --no-owner \
  --no-privileges \
  > waioprime-local.sql
```

Esse comando gera um dump textual chamado `waioprime-local.sql` na raiz do repositorio.

Para confirmar que o arquivo foi criado:

```bash
ls -lh waioprime-local.sql
```

## 5. Importar o dump local para o novo banco remoto

Depois que o banco remoto `waioprime` existir, envie o dump:

```bash
cd /Users/adrielss/www/waioprime
cat waioprime-local.sql | docker run --rm -i \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=waioprime user=<RENDER_USER> sslmode=require"
```

Se a importacao terminar sem erro, o schema e os dados locais passam a existir no banco remoto.

## 6. Validar a importacao

### 6.1 Listar tabelas

```bash
docker run --rm -it \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=waioprime user=<RENDER_USER> sslmode=require" \
  -c "\\dt"
```

### 6.2 Conferir a tabela de migrations do Prisma

```bash
docker run --rm -it \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=waioprime user=<RENDER_USER> sslmode=require" \
  -c "SELECT migration_name, finished_at FROM \"_prisma_migrations\" ORDER BY finished_at;"
```

### 6.3 Conferir contagem de tabelas importantes

Exemplos:

```bash
docker run --rm -it \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=waioprime user=<RENDER_USER> sslmode=require" \
  -c "SELECT COUNT(*) FROM users;"
```

```bash
docker run --rm -it \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=waioprime user=<RENDER_USER> sslmode=require" \
  -c "SELECT COUNT(*) FROM sessions;"
```

```bash
docker run --rm -it \
  -e PGPASSWORD='<RENDER_PASSWORD>' \
  postgres:16-alpine \
  psql "host=<RENDER_HOST> port=5432 dbname=waioprime user=<RENDER_USER> sslmode=require" \
  -c "SELECT COUNT(*) FROM chat_messages;"
```

## 7. Atualizar a API para usar o banco da Render

Depois da importacao, atualize a `DATABASE_URL` da API.

### 7.1 Exemplo usando URL externa da Render

```env
DATABASE_URL=postgresql://<RENDER_USER>:<RENDER_PASSWORD>@<RENDER_HOST>:5432/waioprime?sslmode=require
```

### 7.2 Exemplo usando URL interna da Render

Use somente quando a API estiver na mesma conta/workspace e mesma regiao:

```env
DATABASE_URL=postgresql://<RENDER_USER>:<RENDER_PASSWORD>@<RENDER_INTERNAL_HOST>:5432/waioprime?schema=public
```

## 8. Rodar a validacao do Prisma na API

Se o banco remoto ja recebeu o dump completo do banco local, o esperado e que o Prisma encontre a tabela `_prisma_migrations` preenchida.

Ainda assim, rode o deploy de migrations como verificacao final:

```bash
cd /Users/adrielss/www/waioprime/api
pnpm prisma migrate deploy
```

Se nao houver divergencia, o Prisma deve informar que nao existem migrations pendentes.

## 9. Validar a API apontando para o banco remoto

Com a `DATABASE_URL` atualizada:

```bash
cd /Users/adrielss/www/waioprime/api
pnpm dev
```

Ou no Docker Compose, usando o ambiente correspondente ao deploy.

Depois valide o healthcheck:

```bash
curl -i http://localhost:3333/health
```

## 10. O que este processo nao copia

Este processo copia apenas o banco PostgreSQL.

Ele nao copia automaticamente:

- arquivos em `api/storage/`;
- midias ja salvas em disco local;
- volumes locais fora do PostgreSQL;
- segredos do ambiente;
- configuracao da Render.

Se voce precisa manter as midias antigas do chat, a migracao do banco nao basta. Os arquivos em `api/storage/media` exigem uma migracao separada.

## 11. Troubleshooting

### `psql: not found`

Use o cliente via Docker, como mostrado neste documento.

### Erro no comando `\l`

Algumas combinacoes de versao entre cliente e servidor podem falhar nos meta-comandos do `psql`.

Use SQL puro:

```sql
SELECT datname FROM pg_database ORDER BY datname;
```

### `sslmode=require`

Para URL externa da Render, mantenha `sslmode=require`.

### Importacao falha no meio do processo

Se o banco remoto ficar parcialmente preenchido e voce quiser recomecar com seguranca:

1. apague o banco remoto criado;
2. crie o banco novamente;
3. repita a importacao.

Se o banco de destino ja contiver dados importantes, nao importe por cima sem revisar antes.

## 12. Resumo rapido

Criar banco remoto:

```sql
CREATE DATABASE waioprime;
```

Exportar banco local:

```bash
docker exec -i waioprime_postgres pg_dump -U waioprime -d waioprime --no-owner --no-privileges > waioprime-local.sql
```

Importar no banco remoto:

```bash
cat waioprime-local.sql | docker run --rm -i -e PGPASSWORD='<RENDER_PASSWORD>' postgres:16-alpine psql "host=<RENDER_HOST> port=5432 dbname=waioprime user=<RENDER_USER> sslmode=require"
```

Atualizar a API:

```env
DATABASE_URL=postgresql://<RENDER_USER>:<RENDER_PASSWORD>@<RENDER_HOST>:5432/waioprime?sslmode=require
```