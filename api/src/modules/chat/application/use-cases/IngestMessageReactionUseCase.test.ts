import { describe, it, expect, vi } from 'vitest';
import {
  IngestMessageReactionUseCase,
  type IngestMessageReactionInput,
} from './IngestMessageReactionUseCase';
import { decideReactionWrite } from '../../domain/services/decideReactionWrite';
import type { ChatMessageReaction } from '../../domain/entities/ChatMessageReaction';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type {
  ApplyReactionInput,
  IChatMessageReactionRepository,
} from '../../domain/contracts/IChatMessageReactionRepository';

const TENANT = 'tenant-1';
const MSG = 'msg-1';
const CONV = 'conv-1';
const SERVER_NOW = new Date('2026-09-24T12:00:00.000Z');

/**
 * Repositório de reações em memória que decide pela mesma regra do domínio que o
 * repositório Prisma usa — assim os cenários de ordem ficam realistas.
 */
function makeReactionRepo(initial: ChatMessageReaction[] = []) {
  const rows = new Map(initial.map((r) => [r.reactorKey, r]));
  let tick = 0;
  const repo = {
    apply: vi.fn(async (input: ApplyReactionInput) => {
      const current = rows.get(input.reactorKey) ?? null;
      const decision = decideReactionWrite(current, input);
      if (decision.applied) {
        rows.set(input.reactorKey, {
          id: current?.id ?? `r-${input.reactorKey}`,
          tenantId: input.tenantId,
          messageId: input.messageId,
          emoji: input.emoji,
          reactorKey: input.reactorKey,
          reactorPhone: input.reactorPhone,
          reactorName: input.reactorName,
          fromMe: input.fromMe,
          externalId: input.externalId,
          reactedAt: input.reactedAt,
          createdAt: current?.createdAt ?? SERVER_NOW,
          updatedAt: new Date(SERVER_NOW.getTime() + ++tick),
        });
      }
      return decision;
    }),
    findByMessageId: vi.fn(async () => [...rows.values()]),
    findByMessageIds: vi.fn(async () => [...rows.values()]),
  };
  return repo as typeof repo & IChatMessageReactionRepository;
}

function makeDeps(opts?: { target?: null; reactions?: ChatMessageReaction[] }) {
  const target = opts?.target === null ? null : { id: MSG, conversationId: CONV, tenantId: TENANT };
  const messageRepo = {
    findByExternalId: vi.fn().mockResolvedValue(target),
  } as unknown as IChatMessageRepository;
  const reactionRepo = makeReactionRepo(opts?.reactions);
  const contactRepo = {
    findByPhones: vi.fn().mockResolvedValue([
      { phone: '5511988887777', name: 'Maria da Agenda', avatarUrl: null },
    ]),
  } as unknown as IChatContactRepository;
  const useCase = new IngestMessageReactionUseCase(
    messageRepo, reactionRepo, contactRepo, () => SERVER_NOW,
  );
  return { messageRepo, reactionRepo, contactRepo, useCase };
}

function input(over: Partial<IngestMessageReactionInput> = {}): IngestMessageReactionInput {
  return {
    tenantId: TENANT,
    sessionId: 'sess-1',
    targetExternalMessageId: 'ext-1',
    emoji: '👍',
    reactorKey: 'pn:5511988887777',
    reactorPhone: '5511988887777',
    reactorName: 'Maria (pushName)',
    fromMe: false,
    isEcho: false,
    reactionExternalId: 'react-ext-1',
    reactedAt: new Date('2026-09-24T11:00:00.000Z'),
    ...over,
  };
}

function reactionRow(over: Partial<ChatMessageReaction>): ChatMessageReaction {
  return {
    id: 'r-self', tenantId: TENANT, messageId: MSG, emoji: '👍', reactorKey: 'self',
    reactorPhone: null, reactorName: null, fromMe: true, externalId: null,
    reactedAt: SERVER_NOW, createdAt: SERVER_NOW, updatedAt: SERVER_NOW,
    ...over,
  };
}

describe('IngestMessageReactionUseCase', () => {
  it('ignora reação a mensagem que não existe, sem gravar nada', async () => {
    const deps = makeDeps({ target: null });

    const out = await deps.useCase.execute(input());

    expect(out).toBeNull();
    expect(deps.messageRepo.findByExternalId).toHaveBeenCalledWith('ext-1', TENANT);
    expect(deps.reactionRepo.apply).not.toHaveBeenCalled();
    expect(deps.reactionRepo.findByMessageId).not.toHaveBeenCalled();
    expect(deps.contactRepo.findByPhones).not.toHaveBeenCalled();
  });

  it('devolve o agregado com o nome do contato quando a reação muda o estado', async () => {
    const deps = makeDeps();

    const out = await deps.useCase.execute(input());

    expect(out).toEqual({
      conversationId: CONV,
      messageId: MSG,
      reactionsRevision: expect.any(String),
      reactions: [{
        emoji: '👍', count: 1, reactedByMe: false,
        reactors: [{ name: 'Maria da Agenda', phone: '5511988887777' }],
      }],
    });
    expect(deps.contactRepo.findByPhones).toHaveBeenCalledWith(['5511988887777'], TENANT);
  });

  it('eco repetido do próprio envio não publica nada', async () => {
    // O painel já gravou 👍 com o carimbo do servidor; o eco chega com o mesmo carimbo.
    const deps = makeDeps({ reactions: [reactionRow({})] });

    const out = await deps.useCase.execute(input({
      fromMe: true, isEcho: true, reactorKey: 'self', reactorPhone: null, reactedAt: SERVER_NOW,
    }));

    expect(out).toBeNull();
    expect(deps.reactionRepo.findByMessageId).not.toHaveBeenCalled();
  });

  it('remoção grava tombstone passando emoji nulo ao repositório', async () => {
    const deps = makeDeps({
      reactions: [reactionRow({
        reactorKey: 'pn:5511988887777', fromMe: false, reactorPhone: '5511988887777',
        reactedAt: new Date('2026-09-24T10:00:00.000Z'),
      })],
    });

    const out = await deps.useCase.execute(input({ emoji: null }));

    expect(deps.reactionRepo.apply).toHaveBeenCalledWith(expect.objectContaining({ emoji: null }));
    expect(out?.reactions).toEqual([]);
    expect(out?.reactionsRevision).not.toBeNull();
  });

  it('reação feita no celular do operador usa o relógio do servidor, não o do aparelho', async () => {
    const deps = makeDeps();

    await deps.useCase.execute(input({
      fromMe: true, isEcho: false, reactorKey: 'self', reactorPhone: null,
      reactedAt: new Date('2026-09-24T11:55:00.000Z'), // celular 5 min atrasado
    }));

    expect(deps.reactionRepo.apply).toHaveBeenCalledWith(
      expect.objectContaining({ reactedAt: SERVER_NOW, reactorKey: 'self', fromMe: true }),
    );
  });

  it('reação da nossa conta sempre grava com a mesma chave do painel', async () => {
    const deps = makeDeps();

    await deps.useCase.execute(input({ fromMe: true, isEcho: true, reactorKey: 'pn:5511000000000' }));

    expect(deps.reactionRepo.apply).toHaveBeenCalledWith(expect.objectContaining({ reactorKey: 'self' }));
  });

  it('eco atrasado de um clique anterior não sobrescreve o gesto mais novo', async () => {
    // Cliques rápidos: painel gravou ❤️ em T1; o eco do 👍 (carimbo T0 < T1) chega depois.
    const t0 = new Date('2026-09-24T11:59:58.000Z');
    const t1 = new Date('2026-09-24T11:59:59.000Z');
    const deps = makeDeps({ reactions: [reactionRow({ emoji: '❤️', reactedAt: t1 })] });

    const out = await deps.useCase.execute(input({
      fromMe: true, isEcho: true, reactorKey: 'self', reactorPhone: null, emoji: '👍', reactedAt: t0,
    }));

    expect(deps.reactionRepo.apply).toHaveBeenCalledWith(expect.objectContaining({ reactedAt: t0 }));
    await expect(deps.reactionRepo.apply.mock.results[0].value).resolves.toEqual({
      applied: false, changed: false,
    });
    expect(out).toBeNull();
  });

  it('reação de terceiro usa o carimbo do evento', async () => {
    const deps = makeDeps();
    const stamp = new Date('2026-09-24T11:30:00.000Z');

    await deps.useCase.execute(input({ reactedAt: stamp }));

    expect(deps.reactionRepo.apply).toHaveBeenCalledWith(expect.objectContaining({ reactedAt: stamp }));
  });

  it('não depende do repositório de conversa: não há como escrever nela', () => {
    // Garantia por construção (design §7.1): a conversa não é dependência do use case,
    // logo prévia, não lidas, status e arquivamento ficam intactos por este caminho.
    expect(IngestMessageReactionUseCase.length).toBeLessThanOrEqual(4);
    const deps = makeDeps();
    expect(Object.keys(deps.useCase)).not.toContain('conversationRepo');
  });
});
