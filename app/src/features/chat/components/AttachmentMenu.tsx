import { useId, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, useMediaQuery } from '@mui/material';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import { chatStrings } from '../strings';

const texts = chatStrings.attachments;

/** De onde veio a escolha: define a finalidade do upload (`media` pode virar documento na API). */
export type AttachmentOrigin = 'media' | 'document';

const MEDIA_ACCEPT = 'image/*,video/*';
const TOUCH_TARGET = 40;

interface Props {
  onFiles: (files: File[], origin: AttachmentOrigin) => void;
  disabled?: boolean;
  /** Tooltip do clipe desabilitado; sem ele, o aviso padrão de indisponível. */
  disabledReason?: string;
}

export function AttachmentMenu({ onFiles, disabled = false, disabledReason }: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const buttonId = useId();
  const menuId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const open = anchorEl !== null && !disabled;

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    if (!disabled) setAnchorEl(event.currentTarget);
  };

  const pick = (origin: AttachmentOrigin) => {
    setAnchorEl(null);
    // Ainda dentro do clique do operador: o navegador só abre o seletor com gesto do usuário.
    (origin === 'media' ? mediaInputRef : documentInputRef).current?.click();
  };

  const handleChange = (origin: AttachmentOrigin) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Limpa para que escolher o mesmo arquivo de novo dispare `change`.
    event.target.value = '';
    if (disabled || files.length === 0) return;
    onFiles(files, origin);
  };

  return (
    <>
      <Tooltip
        title={disabled ? (disabledReason ?? texts.unavailable) : chatStrings.composer.attach}
        describeChild={disabled}
        disableInteractive
      >
        {/* `aria-disabled` em vez de `disabled`: o botão segue focável e o motivo chega ao teclado. */}
        <IconButton
          id={buttonId}
          aria-label={chatStrings.composer.attach}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-disabled={disabled || undefined}
          disableRipple={disabled}
          onClick={handleOpen}
          sx={(theme) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            color: disabled
              ? theme.palette.text.disabled
              : open
                ? theme.palette.primary.main
                : theme.palette.text.secondary,
            cursor: disabled ? 'default' : 'pointer',
            '&:hover': { bgcolor: disabled ? 'transparent' : theme.palette.action.hover },
            '&.Mui-focusVisible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          })}
        >
          <AttachFileOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        // O clipe fica no rodapé: o menu abre para cima.
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transitionDuration={reduceMotion ? 0 : 'auto'}
        slotProps={{ list: { id: menuId, 'aria-label': texts.menuLabel } }}
      >
        <MenuItem onClick={() => pick('document')} sx={{ minHeight: TOUCH_TARGET }}>
          <ListItemIcon>
            <DescriptionOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{texts.document}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => pick('media')} sx={{ minHeight: TOUCH_TARGET }}>
          <ListItemIcon>
            <PhotoLibraryOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{texts.photosAndVideos}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Inputs fora da árvore de acessibilidade; o rótulo só identifica cada origem. */}
      <input
        ref={documentInputRef}
        type="file"
        hidden
        multiple
        tabIndex={-1}
        disabled={disabled}
        aria-label={texts.document}
        onChange={handleChange('document')}
      />
      <input
        ref={mediaInputRef}
        type="file"
        hidden
        multiple
        accept={MEDIA_ACCEPT}
        tabIndex={-1}
        disabled={disabled}
        aria-label={texts.photosAndVideos}
        onChange={handleChange('media')}
      />
    </>
  );
}
