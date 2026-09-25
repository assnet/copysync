import { describe, it, expect } from 'vitest';
import { generateWAMessage, proto } from '@whiskeysockets/baileys';
import { buildBaileysQuotedMessage, type BaileysQuotedMessage } from './buildBaileysQuotedMessage';
import type { QuotedMessageRef } from '../../../domain/contracts/IMessagingEngine';

// Mesma regra do adapter (`normalizeJid`): telefone vira JID; o que já tem `@` passa direto.
const normalizeJid = (value: string) =>
  value.includes('@') ? value : `${value.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

const CONTATO = '5511999999999@s.whatsapp.net';
const GRUPO = '120363000000000000@g.us';

const ref = (over: Partial<QuotedMessageRef> = {}): QuotedMessageRef => ({
  externalId: 'EXT-1',
  remoteJid: '5511999999999',
  fromMe: false,
  body: 'olá',
  type: 'TEXT',
  ...over,
});

const build = (r: QuotedMessageRef, chatJid = CONTATO) => buildBaileysQuotedMessage(r, chatJid, normalizeJid);
const quotedOf = (r: QuotedMessageRef, chatJid = CONTATO) => build(r, chatJid).quoted as BaileysQuotedMessage;

describe('buildBaileysQuotedMessage — key', () => {
  it('conversa individual usa o JID do destino e o id externo da citada', () => {
    expect(quotedOf(ref()).key).toEqual({ remoteJid: CONTATO, fromMe: false, id: 'EXT-1' });
  });

  it('mensagem nossa vai com fromMe e sem participant', () => {
    expect(quotedOf(ref({ remoteJid: GRUPO, fromMe: true, participant: '5551804625870' }), GRUPO).key).toEqual({
      remoteJid: GRUPO, fromMe: true, id: 'EXT-1',
    });
  });

  it('grupo com mensagem de outro autor leva o autor normalizado como participant', () => {
    const quoted = quotedOf(ref({ remoteJid: GRUPO, participant: '5551804625870' }), GRUPO);
    expect(quoted.key.participant).toBe('5551804625870@s.whatsapp.net');
  });

  it('grupo sem autor conhecido não cita — senão a citação sairia atribuída ao grupo', () => {
    expect(build(ref({ remoteJid: GRUPO }), GRUPO)).toEqual({ quoted: null, skipped: 'group_without_participant' });
  });

  it('referência de outra conversa não cita — senão viraria citação de outro chat', () => {
    expect(build(ref({ remoteJid: '5511888888888' }))).toEqual({ quoted: null, skipped: 'different_chat' });
  });

  it('conversa individual ignora participant', () => {
    expect(quotedOf(ref({ participant: '5551804625870' })).key).not.toHaveProperty('participant');
  });
});

describe('buildBaileysQuotedMessage — conteúdo citado', () => {
  it.each([
    ['TEXT', 'olá', { conversation: 'olá' }],
    ['TEXT', null, { conversation: ' ' }],
    ['TEXT', '   ', { conversation: ' ' }],
    ['IMAGE', 'legenda', { imageMessage: { caption: 'legenda' } }],
    ['IMAGE', null, { imageMessage: {} }],
    ['VIDEO', 'clipe', { videoMessage: { caption: 'clipe' } }],
    ['AUDIO', null, { audioMessage: { seconds: 0, ptt: false } }],
    ['DOCUMENT', 'contrato', { documentMessage: { title: 'contrato' } }],
    ['DOCUMENT', null, { documentMessage: {} }],
    ['STICKER', null, { stickerMessage: {} }],
    ['VCARD', 'Maria', { contactMessage: { displayName: 'Maria' } }],
    ['LOCATION', 'Rua A, 10', { conversation: 'Rua A, 10' }],
    ['CALL_LOG', 'Chamada', { conversation: 'Chamada' }],
    ['EVENT', null, { conversation: ' ' }],
    ['image', 'minúsculo', { imageMessage: { caption: 'minúsculo' } }],
  ])('%s com corpo %j', (type, body, expected) => {
    expect(quotedOf(ref({ type, body })).message).toEqual(expected);
  });
});

// Contrato com a lib real: se uma atualização do Baileys mudar como o `quoted` vira
// `contextInfo`, estes testes quebram antes de a citação sumir em produção.
describe('buildBaileysQuotedMessage — contextInfo gerado pelo Baileys', () => {
  const SESSAO = '5547740003804:12@s.whatsapp.net';
  const silent = {
    level: 'silent', child() { return this; },
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  };

  async function contextInfoFor(quoted: BaileysQuotedMessage, chatJid: string) {
    const msg = await generateWAMessage(chatJid, { text: 'resposta' }, {
      userJid: SESSAO,
      quoted: quoted as never,
      logger: silent as never,
      // Texto não sobe mídia; se a lib tentar, o teste falha.
      upload: (async () => { throw new Error('upload inesperado'); }) as never,
    });
    // Precisa sobreviver à serialização que vai para o WhatsApp.
    const decoded = proto.Message.decode(proto.Message.encode(msg.message!).finish());
    return decoded.extendedTextMessage?.contextInfo;
  }

  it('individual: autor = contato, sem remoteJid de outra conversa', async () => {
    const ci = await contextInfoFor(quotedOf(ref()), CONTATO);
    expect(ci?.stanzaId).toBe('EXT-1');
    expect(ci?.participant).toBe(CONTATO);
    expect(ci?.remoteJid ?? null).toBeNull();
    expect(ci?.quotedMessage?.conversation).toBe('olá');
  });

  it('grupo: autor = participante, não o grupo', async () => {
    const quoted = quotedOf(ref({ remoteJid: GRUPO, participant: '5551804625870' }), GRUPO);
    const ci = await contextInfoFor(quoted, GRUPO);
    expect(ci?.participant).toBe('5551804625870@s.whatsapp.net');
    expect(ci?.remoteJid ?? null).toBeNull();
  });

  it('mensagem nossa: autor = número da sessão, sem o device', async () => {
    const ci = await contextInfoFor(quotedOf(ref({ fromMe: true })), CONTATO);
    expect(ci?.participant).toBe('5547740003804@s.whatsapp.net');
  });

  it.each(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'VCARD', 'LOCATION'])(
    'citação de %s sem corpo gera contextInfo válido',
    async (type) => {
      const ci = await contextInfoFor(quotedOf(ref({ type, body: null })), CONTATO);
      expect(ci?.stanzaId).toBe('EXT-1');
      expect(ci?.quotedMessage).toBeTruthy();
    },
  );
});
