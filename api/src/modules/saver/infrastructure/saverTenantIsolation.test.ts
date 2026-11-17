import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Trava estática (SAVER-46, design.md §3): só o repositório `Platform*` lê `saver_contacts` sem tenant.
 * Os demais acessam a base apenas por JOIN a partir de vínculos filtrados por `tenantId`.
 */
const dir = join(__dirname, 'repositories');
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));

describe('isolamento do tenant nos repositórios do Saver', () => {
  it('só PrismaPlatformSaverContactRepository usa o model de contato da plataforma', () => {
    const offenders = sources
      .filter((s) => s.file !== 'PrismaPlatformSaverContactRepository.ts' && /\.saverContact\./.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('fora do Platform*, SQL com saver_contacts só entra por JOIN em consulta com tenantId', () => {
    for (const s of sources.filter((x) => x.file !== 'PrismaPlatformSaverContactRepository.ts')) {
      if (!s.text.includes('"saver_contacts"')) continue;
      expect(s.text).toMatch(/JOIN "saver_contacts" c ON c\."id" = m\."contactId"\s+WHERE m\."tenantId" = \$\{/);
      expect(s.text.match(/"saver_contacts"/g)).toHaveLength(1);
    }
  });

  it('métodos de repositório de tenant recebem tenantId', () => {
    const tenantRepos = ['PrismaSaverGroupRepository.ts', 'PrismaSaverMembershipRepository.ts', 'PrismaSaverConfigRepository.ts',
      'PrismaSaverExportGrantRepository.ts', 'PrismaSaverTeamReader.ts'];
    for (const s of sources.filter((x) => tenantRepos.includes(x.file))) {
      const methods = [...s.text.matchAll(/^ {2}(?:async \*?|async )?([a-zA-Z]+)\(([^)]*)\)/gm)]
        .filter(([, name]) => name !== 'constructor' && !['from', 'pagePerContact', 'pagePerGroup'].includes(name!));
      for (const [, name, params] of methods) {
        expect(`${s.file}#${name}: ${/tenantId|query|q: /.test(params!)}`).toBe(`${s.file}#${name}: true`);
      }
    }
  });
});
