import { useEffect, useRef, useState } from 'react';
import {
  Menu, MenuItem, ListItemIcon, ListItemText, Divider, TextField, Box, Button,
} from '@mui/material';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import PlaylistAddOutlinedIcon from '@mui/icons-material/PlaylistAddOutlined';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import MarkChatUnreadOutlinedIcon from '@mui/icons-material/MarkChatUnreadOutlined';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import type { ChatConversation } from '../types';

export interface ConversationStateChange {
  archived?: boolean;
  pinned?: boolean;
  muteMs?: number | null;
  favorite?: boolean;
  unread?: boolean;
  lists?: string[];
}

interface Props {
  conversation: ChatConversation;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onChange: (change: ConversationStateChange) => void;
  /** Listas já usadas em outras conversas, para reaproveitar os nomes. */
  knownLists?: string[];
}

const HOUR = 60 * 60 * 1000;
const MUTE_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: '8 horas', ms: 8 * HOUR },
  { label: '1 semana', ms: 7 * 24 * HOUR },
  // O WhatsApp trata "Sempre" como um prazo muito longo, não como ausência de prazo.
  { label: 'Sempre', ms: 365 * 24 * HOUR },
];

/**
 * Ações da conversa, na ordem do WhatsApp Web.
 *
 * Arquivar, fixar, silenciar e marcar como não lida são espelhados no WhatsApp.
 * Favoritos e listas ficam no painel: o protocolo não expõe equivalentes.
 */
export function ConversationActionsMenu({ conversation, anchorEl, onClose, onChange, knownLists = [] }: Props) {
  const [muteAnchor, setMuteAnchor] = useState<HTMLElement | null>(null);
  const [listAnchor, setListAnchor] = useState<HTMLElement | null>(null);
  const [newList, setNewList] = useState('');

  // Um pequeno atraso antes de fechar evita que o submenu suma enquanto o ponteiro
  // atravessa o vão entre o item e o painel.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = (close: () => void) => {
    cancelClose();
    closeTimer.current = setTimeout(close, 180);
  };
  useEffect(() => cancelClose, []);

  /** Passar por um item sem submenu fecha o submenu que estiver aberto. */
  const closeSubmenusOnHover = () => {
    cancelClose();
    setMuteAnchor(null);
    setListAnchor(null);
  };

  const isMuted = Boolean(conversation.mutedUntil && new Date(conversation.mutedUntil) > new Date());
  const currentLists = conversation.lists ?? [];

  const apply = (change: ConversationStateChange) => {
    onChange(change);
    setMuteAnchor(null);
    setListAnchor(null);
    onClose();
  };

  const toggleList = (list: string) => {
    const next = currentLists.includes(list)
      ? currentLists.filter((l) => l !== list)
      : [...currentLists, list];
    apply({ lists: next });
  };

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => apply({ archived: !conversation.archived })} onMouseEnter={closeSubmenusOnHover} dense>
          <ListItemIcon>
            {conversation.archived
              ? <UnarchiveOutlinedIcon fontSize="small" />
              : <ArchiveOutlinedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{conversation.archived ? 'Desarquivar conversa' : 'Arquivar conversa'}</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => apply({ pinned: !conversation.pinned })} onMouseEnter={closeSubmenusOnHover} dense>
          <ListItemIcon><PushPinOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{conversation.pinned ? 'Desafixar conversa' : 'Fixar conversa'}</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => apply({ favorite: !conversation.favorite })} onMouseEnter={closeSubmenusOnHover} dense>
          <ListItemIcon>
            {conversation.favorite
              ? <FavoriteIcon fontSize="small" />
              : <FavoriteBorderIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            {conversation.favorite ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
          </ListItemText>
        </MenuItem>

        <MenuItem
          onClick={(e) => setListAnchor(e.currentTarget)}
          onMouseEnter={(e) => { cancelClose(); setMuteAnchor(null); setListAnchor(e.currentTarget); }}
          onMouseLeave={() => scheduleClose(() => setListAnchor(null))}
          dense
        >
          <ListItemIcon><PlaylistAddOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Adicionar à lista</ListItemText>
          <ArrowRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />
        </MenuItem>

        <MenuItem
          onClick={(e) => (isMuted ? apply({ muteMs: null }) : setMuteAnchor(e.currentTarget))}
          onMouseEnter={(e) => {
            cancelClose();
            setListAnchor(null);
            // Silenciada: o item vira ação direta de reativar, sem submenu.
            if (!isMuted) setMuteAnchor(e.currentTarget);
          }}
          onMouseLeave={() => scheduleClose(() => setMuteAnchor(null))}
          dense
        >
          <ListItemIcon>
            {isMuted
              ? <NotificationsActiveOutlinedIcon fontSize="small" />
              : <NotificationsOffOutlinedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{isMuted ? 'Reativar notificações' : 'Silenciar notificações'}</ListItemText>
          {!isMuted && <ArrowRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
        </MenuItem>

        <Divider />

        <MenuItem onClick={() => apply({ unread: true })} onMouseEnter={closeSubmenusOnHover} dense>
          <ListItemIcon><MarkChatUnreadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Marcar como não lida</ListItemText>
        </MenuItem>
      </Menu>

      {/* Submenu de silenciar */}
      <Menu
        anchorEl={muteAnchor}
        open={Boolean(muteAnchor)}
        onClose={() => { setMuteAnchor(null); onClose(); }}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        // O submenu abre por hover: sem isto o backdrop invisível capturaria o
        // ponteiro e o menu principal deixaria de responder.
        hideBackdrop
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        slotProps={{
          paper: {
            onMouseEnter: cancelClose,
            onMouseLeave: () => scheduleClose(() => setMuteAnchor(null)),
          },
        }}
      >
        {MUTE_OPTIONS.map((opt) => (
          <MenuItem key={opt.label} onClick={() => apply({ muteMs: opt.ms })} dense>
            <ListItemText>{opt.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Submenu de listas */}
      <Menu
        anchorEl={listAnchor}
        open={Boolean(listAnchor)}
        onClose={() => { setListAnchor(null); onClose(); }}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        hideBackdrop
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        slotProps={{
          paper: {
            onMouseEnter: cancelClose,
            onMouseLeave: () => scheduleClose(() => setListAnchor(null)),
          },
        }}
      >
        {knownLists.map((list) => (
          <MenuItem key={list} onClick={() => toggleList(list)} dense>
            <ListItemText>{list}</ListItemText>
            {currentLists.includes(list) && (
              <ListItemText sx={{ textAlign: 'right', ml: 2 }} primaryTypographyProps={{ color: 'primary.main' }}>
                ✓
              </ListItemText>
            )}
          </MenuItem>
        ))}
        {knownLists.length > 0 && <Divider />}
        <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Nova lista"
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newList.trim()) {
                apply({ lists: [...currentLists, newList.trim()] });
                setNewList('');
              }
            }}
            inputProps={{ 'aria-label': 'Nome da nova lista' }}
            sx={{ width: 160, '& .MuiInputBase-input': { fontSize: 13 } }}
          />
          <Button
            size="small"
            disabled={!newList.trim()}
            onClick={() => {
              apply({ lists: [...currentLists, newList.trim()] });
              setNewList('');
            }}
          >
            Criar
          </Button>
        </Box>
      </Menu>
    </>
  );
}
