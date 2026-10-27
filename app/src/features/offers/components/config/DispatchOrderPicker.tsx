import { useId, type KeyboardEvent } from 'react';
import { Box, Card, CardActionArea, Typography, useMediaQuery } from '@mui/material';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import type { OfferDispatchOrder } from '@/types/api.types';
import { offerStrings } from '../../strings';

const t = offerStrings.wizard.confirm.order;

/** Cores das sessões na ilustração (até 4; repete depois). */
export const SESSION_COLORS = ['#4f70e0', '#22c55e', '#f59e0b', '#ec4899'] as const;
export const sessionColor = (index: number) => SESSION_COLORS[index % SESSION_COLORS.length]!;

const light = keyframes`
  0%, 10% { opacity: 0.25; transform: scale(0.8); }
  18%, 100% { opacity: 1; transform: scale(1); }
`;

const ORDERS: readonly OfferDispatchOrder[] = ['SEQUENTIAL', 'INTERLEAVED'];

/** Sequência de envios como índices de sessão, para desenhar a linha do tempo. */
export function orderPreview(groupsPerSession: readonly number[], order: OfferDispatchOrder): number[] {
  const counts = groupsPerSession.map((n) => Math.max(0, n));
  const seq: number[] = [];
  if (order === 'SEQUENTIAL') {
    counts.forEach((n, s) => { for (let i = 0; i < n; i++) seq.push(s); });
    return seq;
  }
  const left = [...counts];
  while (left.some((n) => n > 0)) {
    left.forEach((n, s) => { if (n > 0) { seq.push(s); left[s] = n - 1; } });
  }
  return seq;
}

interface TimelineProps {
  sequence: number[];
  animate: boolean;
}

function Timeline({ sequence, animate }: TimelineProps) {
  const total = sequence.length;
  const cycleMs = Math.max(2400, total * 320 + 1200);
  return (
    <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5, flexWrap: 'wrap' }}>
      {sequence.map((s, i) => (
        <Box
          key={i}
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: sessionColor(s),
            boxShadow: `0 0 0 2px ${alpha(sessionColor(s), 0.25)}`,
            opacity: animate ? 0.25 : 1,
            animation: animate ? `${light} ${cycleMs}ms ease-out infinite` : 'none',
            animationDelay: `${(i * 320)}ms`,
            // Separador visual quando muda de sessão
            ml: i > 0 && sequence[i - 1] !== s ? 0.75 : 0,
          }}
        />
      ))}
    </Box>
  );
}

interface Props {
  value: OfferDispatchOrder;
  onChange: (value: OfferDispatchOrder) => void;
  /** Quantidade de grupos por sessão, na ordem de envio (ilustra a linha do tempo). */
  groupsPerSession: readonly number[];
  /** Nomes das sessões, na mesma ordem (legenda). */
  sessionNames: readonly string[];
  disabled?: boolean;
}

/**
 * Escolha da ordem com várias sessões: dois cartões (rádio) com uma linha do tempo animada que
 * mostra a sequência real dos envios (bolinha = envio, cor = sessão). A animação é decorativa:
 * o estado é definido direto no clique/teclado e some sob `prefers-reduced-motion`.
 */
export function DispatchOrderPicker({ value, onChange, groupsPerSession, sessionNames, disabled }: Props) {
  const theme = useTheme();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const labelId = useId();
  // Ilustração com no máximo 4 por sessão para caber em uma linha
  const preview = groupsPerSession.map((n) => Math.min(4, Math.max(1, n)));

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = ORDERS.indexOf(value);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (idx + 1) % ORDERS.length : (idx - 1 + ORDERS.length) % ORDERS.length;
    onChange(ORDERS[next]!);
  };

  return (
    <Box>
      <Typography id={labelId} variant="subtitle2">{t.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.subtitle}</Typography>

      <Box
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}
      >
        {ORDERS.map((order) => {
          const selected = order === value;
          const copy = order === 'SEQUENTIAL' ? t.sequential : t.interleaved;
          return (
            <Card
              key={order}
              variant="outlined"
              sx={{
                borderColor: selected ? 'primary.main' : 'divider',
                borderWidth: selected ? 2 : 1,
                backgroundColor: selected ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.1 : 0.06) : 'background.paper',
                transition: reduceMotion ? 'none' : 'border-color 200ms, background-color 200ms, transform 200ms',
                transform: selected ? 'translateY(-2px)' : 'none',
              }}
            >
              <CardActionArea
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(order)}
                sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: selected ? 'primary.main' : 'text.primary' }}>
                  {copy.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>{copy.description}</Typography>
                <Timeline sequence={orderPreview(preview, order)} animate={selected && !reduceMotion} />
              </CardActionArea>
            </Card>
          );
        })}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.25, alignItems: 'center' }} aria-hidden>
        {sessionNames.map((name, i) => (
          <Box key={`${name}-${i}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: sessionColor(i) }} />
            <Typography variant="caption" color="text.secondary">{name}</Typography>
          </Box>
        ))}
        <Typography variant="caption" color="text.disabled">{t.legend}</Typography>
      </Box>
    </Box>
  );
}
