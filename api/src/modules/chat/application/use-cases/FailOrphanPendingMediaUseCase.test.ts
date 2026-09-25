import { describe, it, expect, vi } from 'vitest';
import { FailOrphanPendingMediaUseCase } from './FailOrphanPendingMediaUseCase';
import { ChatMessageStatus } from '../../domain/enums/ChatMessageEnums';
import { logger } from '../../../../shared/logger/logger';
import type {
  FailedPendingMessage,
  IChatMessageRepository,
} from '../../domain/contracts/IChatMessageRepository';
import type { IMessageStatusPublisher } from '../contracts/IMessageStatusPublisher';

vi.mock('../../../../shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const NOW = new Date('2026-09-25T12:00:00.000Z');
const AFETADAS: FailedPendingMessage[] = [
  { id: 'msg-1', tenantId: 'tenant-1', conversationId: 'conv-1' },
  { id: 'msg-2', tenantId: 'tenant-2', conversationId: 'conv-9' },
];

function makeUseCase(opts: { enabled: boolean; afetadas?: FailedPendingMessage[]; falhaBanco?: boolean }) {
  const failPending = opts.falhaBanco
    ? vi.fn().mockRejectedValue(new Error('conexão perdida'))
    : vi.fn().mockResolvedValue(opts.afetadas ?? AFETADAS);
  // Registra qualquer acesso ao repositório: com a flag desligada, nenhum pode acontecer.
  const acessos: string[] = [];
  const messageRepo = new Proxy({ failPending } as unknown as IChatMessageRepository, {
    get: (alvo, prop) => {
      acessos.push(String(prop));
      return Reflect.get(alvo, prop);
    },
  });
  const publisher = { publishStatusUpdated: vi.fn() } satisfies IMessageStatusPublisher;
  const useCase = new FailOrphanPendingMediaUseCase(
    messageRepo,
    publisher,
    { enabled: opts.enabled, staleMinutes: 60 },
    () => NOW,
  );
  return { useCase, failPending, acessos, publisher };
}

describe('FailOrphanPendingMediaUseCase', () => {
  describe('com a recuperação desligada (dev apontando para o banco de produção)', () => {
    it('no boot não toca o banco nem publica nada', async () => {
      const { useCase, acessos, publisher } = makeUseCase({ enabled: false });

      await useCase.runBoot();

      expect(acessos).toEqual([]);
      expect(publisher.publishStatusUpdated).not.toHaveBeenCalled();
    });

    it('na varredura periódica não toca o banco nem publica nada', async () => {
      const { useCase, acessos, publisher } = makeUseCase({ enabled: false });

      await useCase.runPeriodic(['msg-3']);

      expect(acessos).toEqual([]);
      expect(publisher.publishStatusUpdated).not.toHaveBeenCalled();
    });
  });

  describe('com a recuperação ligada', () => {
    it('no boot falha toda mídia pendente criada até agora, sem exceções de envio em curso', async () => {
      const { useCase, failPending } = makeUseCase({ enabled: true });

      await useCase.runBoot();

      expect(failPending).toHaveBeenCalledTimes(1);
      expect(failPending).toHaveBeenCalledWith({ olderThan: NOW });
    });

    it('no boot publica FAILED para cada mensagem afetada, no tenant dela', async () => {
      const { useCase, publisher } = makeUseCase({ enabled: true });

      await useCase.runBoot();

      expect(publisher.publishStatusUpdated).toHaveBeenCalledTimes(2);
      expect(publisher.publishStatusUpdated).toHaveBeenNthCalledWith(1, {
        tenantId: 'tenant-1', conversationId: 'conv-1', messageId: 'msg-1', status: ChatMessageStatus.FAILED,
      });
      expect(publisher.publishStatusUpdated).toHaveBeenNthCalledWith(2, {
        tenantId: 'tenant-2', conversationId: 'conv-9', messageId: 'msg-2', status: ChatMessageStatus.FAILED,
      });
    });

    it('na varredura falha só as pendentes além do limite e poupa as que estão sendo enviadas', async () => {
      const { useCase, failPending, publisher } = makeUseCase({ enabled: true, afetadas: [AFETADAS[0]] });

      await useCase.runPeriodic(['msg-7', 'msg-8']);

      expect(failPending).toHaveBeenCalledWith({
        olderThan: new Date('2026-09-25T11:00:00.000Z'),
        excludeIds: ['msg-7', 'msg-8'],
      });
      expect(publisher.publishStatusUpdated).toHaveBeenCalledTimes(1);
      expect(publisher.publishStatusUpdated).toHaveBeenCalledWith({
        tenantId: 'tenant-1', conversationId: 'conv-1', messageId: 'msg-1', status: ChatMessageStatus.FAILED,
      });
    });

    it('sem mensagem afetada não publica nada', async () => {
      const { useCase, publisher } = makeUseCase({ enabled: true, afetadas: [] });

      await useCase.runBoot();
      await useCase.runPeriodic([]);

      expect(publisher.publishStatusUpdated).not.toHaveBeenCalled();
    });

    it('falha do banco no boot só vai para o log e não derruba quem chamou', async () => {
      const { useCase, publisher } = makeUseCase({ enabled: true, falhaBanco: true });

      await expect(useCase.runBoot()).resolves.toBeUndefined();

      expect(publisher.publishStatusUpdated).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('falha do banco na varredura só vai para o log e não derruba o agendamento', async () => {
      const { useCase } = makeUseCase({ enabled: true, falhaBanco: true });

      await expect(useCase.runPeriodic(['msg-1'])).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('falha ao publicar não interrompe o aviso das demais mensagens', async () => {
      const { useCase, publisher } = makeUseCase({ enabled: true });
      publisher.publishStatusUpdated.mockImplementationOnce(() => {
        throw new Error('socket caiu');
      });

      await expect(useCase.runBoot()).resolves.toBeUndefined();

      expect(publisher.publishStatusUpdated).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
