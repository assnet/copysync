import { describe, it, expect } from 'vitest';
import {
  applyExportOptions,
  CSV_BOM,
  csvHeader,
  formatCapturedAt,
  neutralizeFormula,
  platformCsvHeader,
  toCsvLine,
  toPlatformCsvLine,
  toVCardEntry,
  type SaverExportRow,
} from './exportFormatters';

// 2026-11-17 02:30 UTC = 16/11/2026 23:30 em São Paulo (UTC-3): cruza a meia-noite.
const AT = new Date('2026-11-17T02:30:00Z');

function row(o: Partial<SaverExportRow> = {}): SaverExportRow {
  return { name: 'Ana', phone: '5511999990000', lid: '12345', isAdmin: false, active: true, extractedAt: AT, ...o };
}
const line = (o: Partial<SaverExportRow> = {}, prefix?: string) => applyExportOptions(row(o), { prefix })!;

describe('formatCapturedAt', () => {
  it('usa America/Sao_Paulo (instante UTC do dia seguinte)', () => {
    expect(formatCapturedAt(AT)).toBe('16/11/2026 23:30');
    expect(formatCapturedAt(new Date('2026-11-17T03:05:00Z'))).toBe('17/11/2026 00:05');
  });
});

describe('neutralizeFormula', () => {
  it.each(['=1+1', '+5511', '-2', '@SUM(A1)', '\tx', '\rx'])('neutraliza %j', (v) => {
    expect(neutralizeFormula(v)).toBe(`'${v}`);
  });
  it('não mexe em texto comum', () => {
    expect(neutralizeFormula('Ana')).toBe('Ana');
  });
});

describe('CSV', () => {
  it('cabeçalho do tenant com BOM; Grupo só com uma linha por grupo', () => {
    expect(csvHeader()).toBe(`${CSV_BOM}Nome,Telefone,LID,Extraído em\r\n`);
    expect(csvHeader({ onePerGroup: true })).toBe(`${CSV_BOM}Nome,Telefone,LID,Extraído em,Grupo\r\n`);
  });

  it('cabeçalho do super admin', () => {
    expect(platformCsvHeader()).toBe(`${CSV_BOM}Nome,Telefone,LID,Primeira extração,Última extração,Tenants,Grupos\r\n`);
  });

  it('linha básica com data local', () => {
    expect(toCsvLine(line())).toBe('Ana,5511999990000,12345,16/11/2026 23:30\r\n');
  });

  it('escapa vírgula, aspas, quebra de linha e mantém emoji', () => {
    expect(toCsvLine(line({ name: 'Ana, "a" 🚀\nSouza' }))).toBe('"Ana, ""a"" 🚀\nSouza",5511999990000,12345,16/11/2026 23:30\r\n');
  });

  it('neutraliza fórmula no nome e no grupo', () => {
    const out = toCsvLine(line({ name: '=HYPERLINK("x")', groupName: '@grupo' }), { onePerGroup: true });
    expect(out).toBe(`"'=HYPERLINK(""x"")",5511999990000,12345,16/11/2026 23:30,'@grupo\r\n`);
  });

  it('só-LID entra no CSV com telefone vazio', () => {
    expect(toCsvLine(line({ phone: null }))).toBe('Ana,,12345,16/11/2026 23:30\r\n');
  });

  it('sem nome: só o prefixo, ou vazio', () => {
    expect(toCsvLine(line({ name: null }))).toBe(',5511999990000,12345,16/11/2026 23:30\r\n');
    expect(toCsvLine(line({ name: null }, 'VIP'))).toBe('VIP,5511999990000,12345,16/11/2026 23:30\r\n');
    expect(toCsvLine(line({}, 'VIP'))).toBe('VIP Ana,5511999990000,12345,16/11/2026 23:30\r\n');
  });

  it('linha do super admin', () => {
    expect(
      toPlatformCsvLine({ name: 'Ana', phone: '551100', lid: null, firstExtractedAt: AT, lastExtractedAt: null, tenantCount: 2, groupCount: 3 }),
    ).toBe('Ana,551100,,16/11/2026 23:30,,2,3\r\n');
  });
});

describe('vCard', () => {
  it('cartão 3.0 com + e DDI, sem cabeçalho nem campo vazio', () => {
    const card = toVCardEntry(line())!;
    expect(card).toBe('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana\r\nN:;Ana;;;\r\nTEL;TYPE=CELL:+5511999990000\r\nEND:VCARD\r\n');
    for (const l of card.trimEnd().split('\r\n')) expect(l).not.toMatch(/:$/);
    expect(card).not.toContain(CSV_BOM);
  });

  it('só-LID fica fora do vCard', () => {
    expect(toVCardEntry(line({ phone: null }))).toBeNull();
  });

  it('sem nome usa prefixo + número; telefone com + preservado', () => {
    expect(toVCardEntry(line({ name: null }))).toContain('FN:+5511999990000\r\n');
    expect(toVCardEntry(line({ name: null }, 'VIP'))).toContain('FN:VIP +5511999990000\r\n');
  });

  it('escapa vírgula, ponto e vírgula e quebra de linha', () => {
    expect(toVCardEntry(line({ name: 'Ana; Bia,\nC' }))).toContain('FN:Ana\\; Bia\\,\\nC\r\n');
  });
});

describe('applyExportOptions', () => {
  it('remove administradores, sem número e quem saiu conforme as opções', () => {
    expect(applyExportOptions(row({ isAdmin: true }), { excludeAdmins: true })).toBeNull();
    expect(applyExportOptions(row({ phone: null }), { onlyWithPhone: true })).toBeNull();
    expect(applyExportOptions(row({ active: false }), { onlyActive: true })).toBeNull();
    expect(applyExportOptions(row({ isAdmin: true, active: false }))).not.toBeNull();
  });

  it('linha sem telefone e sem LID fica fora; prefixo e nome aparados', () => {
    expect(applyExportOptions(row({ phone: null, lid: null }))).toBeNull();
    expect(applyExportOptions(row({ name: '  ' }), { prefix: ' VIP ' })).toMatchObject({ name: null, prefix: 'VIP' });
  });
});
