import { describe, it, expect } from 'vitest';
import { resolveConversationTarget, buildEngineMessageRef } from './resolveConversationTarget';
import { ChatMessageDirection, ChatMessageType } from '../../domain/enums/ChatMessageEnums';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

// Caracteriza o comportamento que o SendMessageUseCase tinha antes da extração.

const individual = { id: 'conv-1', isGroup: false, groupJid: null, contactId: 'contact-1' };
const grupo = { id: 'conv-2', isGroup: true, groupJid: '120363000000000000', contactId: null };
const contato = { phone: '5511999999999' };

const mensagem = (over: Partial<{ externalMessageId: string | null; direction: ChatMessageDirection }> = {}) => ({
  externalMessageId: 'EXT-1',
  direction: ChatMessageDirection.INBOUND,
  content: 'olá',
  type: ChatMessageType.TEXT,
  ...over,
});

describe('resolveConversationTarget', () => {
  it('conversa individual envia para o telefone do contato', () => {
    expect(resolveConversationTarget(individual, contato)).toEqual({
      recipientPhone: '5511999999999',
      contactPhone: '5511999999999',
      isGroup: false,
    });
  });

  it('conversa de grupo envia para <groupJid>@g.us e não tem contato', () => {
    expect(resolveConversationTarget(grupo, null)).toEqual({
      recipientPhone: '120363000000000000@g.us',
      contactPhone: null,
      isGroup: true,
    });
  });

  it('grupo ignora contato mesmo que venha preenchido', () => {
    expect(resolveConversationTarget(grupo, contato).contactPhone).toBeNull();
  });

  it('isGroup ausente é tratado como conversa individual', () => {
    const conv = { ...individual, isGroup: undefined as unknown as boolean };
    expect(resolveConversationTarget(conv, contato).isGroup).toBe(false);
  });

  it('grupo sem groupJid falha com NotFoundError citando a conversa', () => {
    const conv = { ...grupo, groupJid: null };
    expect(() => resolveConversationTarget(conv, null)).toThrow(NotFoundError);
    expect(() => resolveConversationTarget(conv, null)).toThrow('GroupJid not found: conv-2');
  });

  it('individual sem contato falha com NotFoundError citando o contactId', () => {
    expect(() => resolveConversationTarget(individual, null)).toThrow('Contact not found: contact-1');
  });

  it('individual sem contato e sem contactId falha sem id na mensagem', () => {
    const conv = { ...individual, contactId: null };
    expect(() => resolveConversationTarget(conv, null)).toThrow(/^Contact not found$/);
  });
});

describe('buildEngineMessageRef', () => {
  it('citação em conversa individual usa o telefone do contato como remoteJid', () => {
    const target = resolveConversationTarget(individual, contato);
    expect(buildEngineMessageRef(target, mensagem())).toEqual({
      externalId: 'EXT-1',
      remoteJid: '5511999999999',
      fromMe: false,
      body: 'olá',
      type: ChatMessageType.TEXT,
    });
  });

  it('citação em grupo usa o JID do grupo como remoteJid', () => {
    const target = resolveConversationTarget(grupo, null);
    expect(buildEngineMessageRef(target, mensagem())?.remoteJid).toBe('120363000000000000@g.us');
  });

  it('mensagem enviada por nós vira fromMe = true', () => {
    const target = resolveConversationTarget(individual, contato);
    const ref = buildEngineMessageRef(target, mensagem({ direction: ChatMessageDirection.OUTBOUND }));
    expect(ref?.fromMe).toBe(true);
  });

  it('mensagem sem id externo não gera referência', () => {
    const target = resolveConversationTarget(individual, contato);
    expect(buildEngineMessageRef(target, mensagem({ externalMessageId: null }))).toBeNull();
  });

  it('individual sem contactPhone cai no recipientPhone', () => {
    const target = { recipientPhone: '5511888888888', contactPhone: null, isGroup: false };
    expect(buildEngineMessageRef(target, mensagem())?.remoteJid).toBe('5511888888888');
  });

  it('citação em grupo de mensagem de outro autor leva o autor como participant', () => {
    const target = resolveConversationTarget(grupo, null);
    const ref = buildEngineMessageRef(target, { ...mensagem(), fromParticipant: '5551804625870' });
    expect(ref?.participant).toBe('5551804625870');
  });

  it('citação em grupo de mensagem nossa não leva participant', () => {
    const target = resolveConversationTarget(grupo, null);
    const ref = buildEngineMessageRef(target, {
      ...mensagem({ direction: ChatMessageDirection.OUTBOUND }),
      fromParticipant: '5551804625870',
    });
    expect(ref).not.toHaveProperty('participant');
  });

  it('conversa individual nunca leva participant', () => {
    const target = resolveConversationTarget(individual, contato);
    const ref = buildEngineMessageRef(target, { ...mensagem(), fromParticipant: '5551804625870' });
    expect(ref).not.toHaveProperty('participant');
  });

  it('mídia citada leva MIME, nome e duração para o preview da citação', () => {
    const target = resolveConversationTarget(individual, contato);
    const ref = buildEngineMessageRef(target, {
      ...mensagem(), type: ChatMessageType.DOCUMENT, content: null,
      mimeType: 'application/pdf', fileName: 'contrato.pdf', durationSeconds: null,
    });
    expect(ref).toMatchObject({ mimeType: 'application/pdf', fileName: 'contrato.pdf' });
    expect(ref).not.toHaveProperty('durationSeconds');
  });

  it('grupo sem autor conhecido não inventa participant', () => {
    const target = resolveConversationTarget(grupo, null);
    const ref = buildEngineMessageRef(target, { ...mensagem(), fromParticipant: null });
    expect(ref).not.toHaveProperty('participant');
  });
});
