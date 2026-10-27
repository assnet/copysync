import type { ReactNode } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';

interface Props {
  /** Flag ligada → borra. Desligada → devolve os filhos como estão. */
  when: boolean;
  children: ReactNode;
  /** Raio do desfoque em px. Texto curto 5–6; imagem 10+. */
  radius?: number;
  /** `span` para texto no meio de linha; padrão `div`. */
  inline?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Desfoque visual de dado sensível (gravação/compartilhamento de tela). Mantém o layout
 * (o conteúdo continua ocupando o mesmo espaço) e bloqueia seleção/cópia. É proteção visual,
 * não de acesso: o dado continua no DOM.
 */
export function Blurred({ when, children, radius = 6, inline, sx }: Props) {
  if (!when) return <>{children}</>;
  return (
    <Box
      component={inline ? 'span' : 'div'}
      data-blurred="true"
      sx={{
        display: inline ? 'inline-block' : 'block',
        maxWidth: '100%',
        filter: `blur(${radius}px)`,
        userSelect: 'none',
        pointerEvents: 'none',
        transition: 'filter 200ms',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
