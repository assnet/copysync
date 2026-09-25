import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import { chatStrings } from '../strings';
import { filesFrom, hasFiles } from '../media/dataTransferFiles';

export interface DropZoneOverlayProps {
  /** Conversa encerrada: não mostra a área nem recebe arquivos, e o navegador segue o padrão. */
  disabled?: boolean;
  /** Arquivos soltos, na ordem recebida. Nunca chamado com lista vazia. */
  onFiles: (files: File[]) => void;
  children: ReactNode;
  /** Ajuste de layout do contêiner (por padrão ocupa a coluna do pai). */
  sx?: SxProps<Theme>;
}

const entrada = keyframes`
  from { opacity: 0; transform: scale(0.985); }
  to   { opacity: 1; transform: scale(1); }
`;

/**
 * Envolve a área da conversa e aceita arquivos arrastados. Os eventos ficam no contêiner e o
 * overlay tem `pointer-events: none`, então ele nunca rouba o `drop` de quem está por baixo.
 */
export function DropZoneOverlay({ disabled = false, onFiles, children, sx }: DropZoneOverlayProps) {
  // Cada filho dispara o próprio enter/leave; só a contagem diz quando o arrasto saiu de fato.
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!disabled) return;
    depth.current = 0;
    setDragging(false);
  }, [disabled]);

  const accepts = (e: DragEvent<HTMLElement>) => !disabled && hasFiles(e.dataTransfer);

  const handleDragEnter = (e: DragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = () => {
    if (depth.current === 0) return;
    depth.current -= 1;
    if (depth.current === 0) setDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    // Dentro do handler: depois dele o navegador esvazia a lista.
    const files = filesFrom(e.dataTransfer);
    if (files.length > 0) onFiles(files);
  };

  const visible = dragging && !disabled;

  return (
    <Box
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={[
        { position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}

      {/* Região viva sempre montada: leitores de tela só anunciam mudança em região que já existia. */}
      <Box
        role="status"
        aria-live="polite"
        aria-atomic="true"
        // Acima do botão de rolar da lista (zIndex 10).
        sx={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}
      >
        {visible && (
          <Box
            sx={(theme) => {
              const isDark = theme.palette.mode === 'dark';
              const accent = isDark ? theme.palette.primary.light : theme.palette.primary.dark;
              return {
                position: 'absolute',
                inset: { xs: 8, sm: 12 },
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                px: 3,
                textAlign: 'center',
                borderRadius: 2,
                border: `2px dashed ${alpha(theme.palette.primary.main, isDark ? 0.7 : 0.55)}`,
                // Véu do papel com tinta do primary: esconde as bolhas sem sumir com o contexto.
                bgcolor: alpha(theme.palette.background.paper, isDark ? 0.84 : 0.88),
                backgroundImage: `linear-gradient(${alpha(theme.palette.primary.main, isDark ? 0.14 : 0.07)}, ${alpha(theme.palette.primary.main, isDark ? 0.14 : 0.07)})`,
                color: accent,
                animation: `${entrada} 140ms ease-out`,
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              };
            }}
          >
            <Box
              aria-hidden
              sx={(theme) => ({
                display: 'grid',
                placeItems: 'center',
                width: 56,
                height: 56,
                borderRadius: '50%',
                bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.12),
              })}
            >
              <FileUploadOutlinedIcon sx={{ fontSize: 28 }} />
            </Box>
            <Typography variant="subtitle1" component="p" sx={{ color: 'inherit' }}>
              {chatStrings.attachments.dropHere}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
