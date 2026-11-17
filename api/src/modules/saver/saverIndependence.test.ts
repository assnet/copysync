import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Independência do Saver (design §10): nada em `modules/saver` importa de chat, campaigns, automation,
 * link-rotation nem storefront. Varre `import`/`export … from`/`import()`/`require()` de todo arquivo .ts.
 */
const ROOT = __dirname;
const FORBIDDEN = ['chat', 'campaigns', 'automation', 'link-rotation', 'storefront'];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

/** Módulo de `src/modules/<x>` que o especificador relativo alcança; null = fora de `modules`. */
function targetModule(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const rel = path.relative(path.resolve(ROOT, '..'), path.resolve(path.dirname(file), spec));
  if (rel.startsWith('..')) return null;
  return rel.split(path.sep)[0] ?? null;
}

describe('independência do módulo saver', () => {
  const files = tsFiles(ROOT);

  it('varre os arquivos do módulo', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('nenhum import de chat/campaigns/automation/link-rotation/storefront', () => {
    const offending: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(SPECIFIER)) {
        const spec = m[1]!;
        const target = targetModule(file, spec);
        const viaAlias = FORBIDDEN.find((f) => new RegExp(`(^|/)modules/${f}(/|$)`).test(spec));
        if ((target && FORBIDDEN.includes(target)) || viaAlias) offending.push(`${path.relative(ROOT, file)} → ${spec}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('o varredor acusa um import proibido (sanidade)', () => {
    const fake = path.join(ROOT, 'application', 'x.ts');
    expect(targetModule(fake, '../../chat/domain/x')).toBe('chat');
    expect(targetModule(fake, '../../tenants/domain/x')).toBe('tenants');
    expect(targetModule(fake, '../domain/x')).toBe('saver');
  });
});
