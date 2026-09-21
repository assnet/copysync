/**
 * Setup dos testes da API.
 *
 * `shared/config/env` valida as variáveis de ambiente no import e lança quando faltam.
 * Como `logger` depende de `env`, qualquer teste que alcance um módulo com log —
 * listeners, use cases — quebraria antes da primeira asserção.
 *
 * Os valores abaixo são sintéticos e não apontam para nada real: nenhum teste abre
 * conexão. Quem precisar de outro valor sobrescreve no próprio arquivo de teste.
 */
process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'test-secret-nao-usar-fora-de-teste';
process.env['NODE_ENV'] ??= 'test';
