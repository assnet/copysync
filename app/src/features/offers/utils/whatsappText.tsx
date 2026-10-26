import { Fragment, type ReactNode } from 'react';
import { Box, Link } from '@mui/material';

/**
 * Formatação do WhatsApp na prévia: `*negrito*`, `_itálico_`, `~riscado~` e links clicáveis.
 * Só monta nós React (nunca HTML), então texto do usuário ou da IA não injeta nada.
 */
const TOKEN = /(https?:\/\/[^\s]+)|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;

export function renderWhatsAppText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);
    if (m[1]) {
      out.push(
        <Link key={key++} href={m[1]} target="_blank" rel="noopener noreferrer" sx={{ wordBreak: 'break-all' }}>
          {m[1]}
        </Link>,
      );
    } else if (m[2]) out.push(<Box component="strong" key={key++} sx={{ fontWeight: 700 }}>{m[2]}</Box>);
    else if (m[3]) out.push(<em key={key++}>{m[3]}</em>);
    else if (m[4]) out.push(<s key={key++}>{m[4]}</s>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}
