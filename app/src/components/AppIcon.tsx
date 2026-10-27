import type { LucideIcon, LucideProps } from 'lucide-react';

/**
 * Tamanhos padrão de ícone (ver docs/padrao-icones.md).
 * - `inline`: ao lado de texto. Em `em`, acompanha a fonte do texto vizinho — desktop e mobile.
 * - `sm` | `md` | `lg`: ícone isolado (botão, estado vazio), em px.
 */
export const APP_ICON_SIZES = {
  inline: '1.25em',
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export type AppIconSize = keyof typeof APP_ICON_SIZES;

export interface AppIconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon;
  size?: AppIconSize;
  /** Com rótulo, o ícone é lido por leitor de tela; sem, é decorativo (`aria-hidden`). */
  label?: string;
}

/** Único ponto de uso de ícones Lucide no painel: tamanho, traço e acessibilidade padronizados. */
export function AppIcon({ icon: Icon, size = 'inline', label, strokeWidth = 2, style, ...rest }: AppIconProps) {
  return (
    <Icon
      size={APP_ICON_SIZES[size]}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={size !== 'inline'}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      style={{ flexShrink: 0, ...style }}
      {...rest}
    />
  );
}
