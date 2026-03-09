import { Box, Typography, Avatar, Chip, Divider, TextField, IconButton, Tooltip, alpha, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SellOutlinedIcon from '@mui/icons-material/SellOutlined';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import AutoGraphOutlinedIcon from '@mui/icons-material/AutoGraphOutlined';
import PsychologyOutlinedIcon from '@mui/icons-material/PsychologyOutlined';
import type { ChatConversation } from '../types';
import { formatPhone, getStatusConfig } from '../utils';

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function Section({ title, icon, children }: SectionProps) {
  return (
    <Box sx={{ px: 2, py: 1.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.25 }}>
        <Box sx={{ color: 'text.disabled', display: 'flex', alignItems: 'center' }}>{icon}</Box>
        <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={0.7} sx={{ fontSize: 10.5 }}>
          {title}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

// ── Row item ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
      <Typography variant="caption" color="text.disabled" sx={{ minWidth: 72 }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary" fontWeight={500} textAlign="right" noWrap sx={{ flex: 1 }}>
        {value}
      </Typography>
    </Box>
  );
}

// ── Placeholder card ──────────────────────────────────────────────────────────

function ComingSoonCard({ icon, label }: { icon: React.ReactNode; label: string }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        bgcolor: alpha(theme.palette.text.primary, 0.03),
        border: '1px dashed',
        borderColor: 'divider',
        mb: 1,
      }}
    >
      <Box sx={{ color: 'text.disabled', display: 'flex', alignItems: 'center', opacity: 0.5 }}>{icon}</Box>
      <Typography variant="caption" color="text.disabled" sx={{ flex: 1 }}>
        {label}
      </Typography>
      <Chip label="Em breve" size="small" sx={{ height: 16, fontSize: 9, opacity: 0.6 }} />
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  conversation: ChatConversation;
  onClose: () => void;
}

export function ConversationDetailsPanel({ conversation, onClose }: Props) {
  const { contact, session, status, queue, assignedTo, tags, notes } = conversation;
  const statusConfig = getStatusConfig(status);

  return (
    <Box
      sx={{
        width: 280,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle2" fontWeight={700}>
          Contexto
        </Typography>
        <Tooltip title="Fechar painel">
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Scrollable content */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>

        {/* Contact section */}
        <Section title="Contato" icon={<PersonOutlineIcon sx={{ fontSize: 14 }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Avatar sx={{ width: 40, height: 40, bgcolor: contact.avatarColor ?? 'primary.main', fontSize: 14, fontWeight: 700 }}>
              {contact.initials}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={700} noWrap>
                {contact.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatPhone(contact.phone)}
              </Typography>
            </Box>
            <Tooltip title="Editar contato (em breve)">
              <span>
                <IconButton size="small" disabled sx={{ ml: 'auto', opacity: 0.4 }}>
                  <EditOutlinedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Section>

        <Divider />

        {/* Conversation info */}
        <Section title="Conversa" icon={<RouterOutlinedIcon sx={{ fontSize: 14 }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" color="text.disabled">
              Status
            </Typography>
            <Chip
              label={statusConfig.label}
              size="small"
              sx={{
                height: 18,
                fontSize: 10,
                fontWeight: 600,
                bgcolor: alpha(statusConfig.color, 0.12),
                color: statusConfig.color,
                border: `1px solid ${alpha(statusConfig.color, 0.2)}`,
              }}
            />
          </Box>
          {session && (
            <InfoRow label="Sessão" value={`${session.name} (${formatPhone(session.phone)})`} />
          )}
          {queue && <InfoRow label="Fila" value={queue} />}
          {assignedTo && <InfoRow label="Atendente" value={assignedTo} />}
          {!assignedTo && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="caption" color="text.disabled">Atendente</Typography>
              <Typography variant="caption" color="text.disabled" fontStyle="italic">Não atribuído</Typography>
            </Box>
          )}
        </Section>

        <Divider />

        {/* Tags */}
        <Section title="Tags" icon={<SellOutlinedIcon sx={{ fontSize: 14 }} />}>
          {tags.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  sx={{ height: 20, fontSize: 11 }}
                />
              ))}
            </Box>
          ) : (
            <Typography variant="caption" color="text.disabled" fontStyle="italic">
              Nenhuma tag adicionada
            </Typography>
          )}
        </Section>

        <Divider />

        {/* Notes */}
        <Section title="Observações" icon={<NotesOutlinedIcon sx={{ fontSize: 14 }} />}>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={3}
            placeholder="Adicionar observações sobre este contato..."
            defaultValue={notes}
            sx={{
              '& .MuiOutlinedInput-root': { fontSize: 12, borderRadius: 2 },
            }}
          />
        </Section>

        <Divider />

        {/* Participants */}
        <Section title="Participantes" icon={<GroupOutlinedIcon sx={{ fontSize: 14 }} />}>
          <Typography variant="caption" color="text.disabled" fontStyle="italic">
            Nenhum participante adicional
          </Typography>
        </Section>

        <Divider />

        {/* Coming soon integrations */}
        <Section title="Integrações" icon={<AutoGraphOutlinedIcon sx={{ fontSize: 14 }} />}>
          <ComingSoonCard icon={<SmartToyOutlinedIcon sx={{ fontSize: 16 }} />} label="CRM integrado" />
          <ComingSoonCard icon={<PsychologyOutlinedIcon sx={{ fontSize: 16 }} />} label="Assistente IA" />
          <ComingSoonCard icon={<AutoGraphOutlinedIcon sx={{ fontSize: 16 }} />} label="Automações" />
        </Section>

      </Box>
    </Box>
  );
}
