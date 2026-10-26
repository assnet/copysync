import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { AiBaseUrlVerdict, IAiBaseUrlGuard } from '../../domain/contracts/IAiBaseUrlGuard';

export type LookupAllFn = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupAllFn = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Faixas que um endpoint de IA nunca pode ter (RFC 6890 e afins). */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** true = endereço público roteável. O BlockList confere IPv4 mapeado (::ffff:a.b.c.d) nas regras IPv4; NAT64 é bloqueado. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Resolve todos os endereços do host e recusa se qualquer um não for público. Sobra uma janela
 * entre esta consulta e a do `fetch` (TOCTOU); por isso roda a cada chamada e o `fetch` não
 * segue redirect.
 */
export class DnsAiBaseUrlGuard implements IAiBaseUrlGuard {
  constructor(private readonly lookup: LookupAllFn = defaultLookup) {}

  async check(baseUrl: string): Promise<AiBaseUrlVerdict> {
    let host: string;
    try {
      host = new URL(baseUrl).hostname;
    } catch {
      return 'blocked';
    }
    let addresses: Array<{ address: string }>;
    try {
      addresses = await this.lookup(host);
    } catch {
      return 'unresolvable';
    }
    if (addresses.length === 0) return 'unresolvable';
    return addresses.every((a) => isPublicAddress(a.address)) ? 'ok' : 'blocked';
  }
}
