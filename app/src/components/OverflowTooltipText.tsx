import { useRef, type ReactNode } from 'react';
import { Tooltip, Typography, type TypographyProps } from '@mui/material';
import { useIsTruncated } from './useIsTruncated';

export interface OverflowTooltipTextProps {
  /** Texto completo: conteúdo do tooltip e, sem `children`, o que aparece na linha. */
  text: string;
  /** Flag de borrar da tela ligada → nunca mostra o tooltip (não vaza o dado borrado). */
  disabled?: boolean;
  /** Mostra o tooltip mesmo sem corte (a linha resume algo maior que ela, ex.: "A, B e mais 3"). */
  alwaysShow?: boolean;
  /** Foco por teclado quando cortado. Desligue dentro de botão/área clicável (o foco já é do pai). */
  focusable?: boolean;
  typographyProps?: Omit<TypographyProps, 'noWrap' | 'ref' | 'children'>;
  /** Conteúdo exibido (ex.: `<Blurred>`); padrão `text`. */
  children?: ReactNode;
}

/**
 * Linha única com reticências que mostra o texto inteiro no hover/foco/toque, só quando está cortada.
 * Visual = `Typography noWrap` com as props recebidas; tooltip no padrão do painel.
 */
export function OverflowTooltipText({
  text, disabled = false, alwaysShow = false, focusable = true, typographyProps, children,
}: OverflowTooltipTextProps) {
  const ref = useRef<HTMLElement>(null);
  const truncated = useIsTruncated(ref, `${text}|${disabled}`);
  const show = !disabled && (truncated || alwaysShow);

  return (
    <Tooltip title={show ? text : ''} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
      <Typography
        {...typographyProps}
        ref={ref}
        noWrap
        tabIndex={show && focusable ? 0 : typographyProps?.tabIndex}
      >
        {children ?? text}
      </Typography>
    </Tooltip>
  );
}
