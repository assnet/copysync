import type { ChannelEnvelope, ChannelResponse, ChannelError } from '../../contract/channel.js';
import { CHANNEL_NAME, CHANNEL_VERSION } from '../constants.js';
import { devLog, devError } from '../../core/devLog.js';
import { checkGuard } from './guard.js';
import { getHandler } from './handlers.js';
import { assertNoSecrets } from './sanitize.js';
import { isValidEnvelope, isVersionAccepted, isWithinTtl, checkReplay, hasAuthInPayload } from './validate.js';

const makeResponse = <P>(requestId: string, result: ChannelResponse<P>): ChannelEnvelope => ({
  channel: CHANNEL_NAME,
  version: CHANNEL_VERSION,
  direction: 'response',
  requestId,
  timestamp: Date.now(),
  op: '',
  payload: result,
});

const makeError = (requestId: string, error: ChannelError): ChannelEnvelope =>
  makeResponse(requestId, { ok: false, error });

const handleMessage = async (
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<ChannelEnvelope> => {
  const requestId = (message as any)?.requestId ?? crypto.randomUUID();

  if (!isValidEnvelope(message)) {
    return makeError(requestId, { code: 'INVALID_ENVELOPE' });
  }

  if (!isVersionAccepted(message.version)) {
    return makeError(message.requestId, { code: 'INVALID_ENVELOPE' });
  }

  if (!isWithinTtl(message.timestamp)) {
    return makeError(message.requestId, { code: 'INVALID_ENVELOPE' });
  }

  if (checkReplay(message.requestId)) {
    return makeError(message.requestId, { code: 'INVALID_ENVELOPE' });
  }

  if (hasAuthInPayload(message.payload)) {
    return makeError(message.requestId, { code: 'INVALID_ENVELOPE' });
  }

  // Guard
  const guardResult = await checkGuard(message.op);
  if ('code' in guardResult) {
    return makeError(message.requestId, guardResult);
  }

  // Handler
  const handler = getHandler(message.op);
  if (!handler) {
    return makeError(message.requestId, { code: 'UNKNOWN_OP' });
  }

  try {
    const result = await handler(message.payload, guardResult.profile);
    const sanitized = assertNoSecrets(result);
    return makeResponse(message.requestId, sanitized);
  } catch (error) {
    devError('channel handler error', message.op, error);
    return makeError(message.requestId, { code: 'INTERNAL' });
  }
};

export const registerChannel = (): void => {
  chrome.runtime.onMessageExternal.addListener(
    (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
      void handleMessage(message, sender).then(sendResponse);
      return true;
    },
  );
  devLog('channel registered');
};
