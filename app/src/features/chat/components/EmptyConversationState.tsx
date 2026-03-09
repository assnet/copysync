import { Box, Typography, alpha, useTheme } from '@mui/material';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';

export function EmptyConversationState() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        bgcolor: 'background.default',
        px: 4,
      }}
    >
      {/* Icone decorativo */}
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: '28px',
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)} 0%, ${alpha(theme.palette.secondary.main, 0.15)} 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 1,
        }}
      >
        <ForumOutlinedIcon
          sx={{
            fontSize: 38,
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        />
      </Box>

      <Box sx={{ textAlign: 'center', maxWidth: 320 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>
          Nenhuma conversa selecionada
        </Typography>
        <Typography variant="body2" color="text.secondary" lineHeight={1.7}>
          Selecione uma conversa na lista ao lado para visualizar o histórico de mensagens e
          interagir com o contato.
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          mt: 2,
          p: 2.5,
          borderRadius: 3,
          bgcolor: alpha(theme.palette.text.primary, 0.03),
          border: '1px dashed',
          borderColor: 'divider',
          maxWidth: 300,
          width: '100%',
        }}
      >
        {[
          '💬  Atendimento humano e bot',
          '🤖  Assistentes de IA',
          '⚡  Automações e flows',
          '📊  Métricas em tempo real',
        ].map((item) => (
          <Typography key={item} variant="caption" color="text.disabled" sx={{ fontSize: 12 }}>
            {item}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
