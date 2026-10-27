import { createHmac, createHash, randomUUID } from 'node:crypto';

export interface HubRequestHeaders {
  'X-Application-Key': string;
  'X-Timestamp': string;
  'X-Nonce': string;
  'X-Signature': string;
}

export function signHubRequest(opts: {
  method: string;
  path: string;
  query?: string;
  body?: string;
  applicationKey: string;
  secret: string;
}): HubRequestHeaders {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = createHash('sha256')
    .update(opts.body ?? '')
    .digest('hex');

  const canonical = [
    opts.method.toUpperCase(),
    opts.path,
    opts.query ?? '',
    timestamp,
    nonce,
    bodyHash,
  ].join('\n');

  const signature = createHmac('sha256', opts.secret)
    .update(canonical)
    .digest('hex');

  return {
    'X-Application-Key': opts.applicationKey,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
}
