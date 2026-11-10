import { useId } from 'react';
import { Box, Card, CardActionArea, Tooltip, Typography } from '@mui/material';
import { AppIcon } from '@/components';
import { PlanAvailabilityBadges } from '@/features/plans/components/PlanAvailabilityBadges';
import type { OfferAudience } from '@/types/api.types';
import { offerStrings } from '../strings';
import { AUDIENCE_ICONS, OFFER_AUDIENCES, effectiveAudience } from '../utils/offerConfig';

interface Props {
  value: OfferAudience;
  onChange: (value: OfferAudience) => void;
  disabled?: boolean;
  /** Rótulo acessível do grupo de opções. */
  label: string;
  /** "Reescrita com IA" fora do plano: só "Padrão" fica selecionável (os demais usam IA). */
  aiLocked?: boolean;
}

/**
 * Cartões de escolha única do público-alvo (ícone + nome na mesma linha, tom do texto abaixo).
 * Com `aiLocked`, os públicos escritos pela IA ficam desabilitados, o salvo vale como "Padrão" e
 * aparecem os selos dos planos que liberam com o aviso.
 */
export function AudiencePicker({ value, onChange, disabled, label, aiLocked = false }: Props) {
  const noteId = useId();
  const current = effectiveAudience(value, aiLocked);
  return (
    <Box>
      <Box
        role="radiogroup"
        aria-label={label}
        aria-describedby={aiLocked ? noteId : undefined}
        sx={{
          display: 'grid',
          gap: 1,
          // Colunas pela largura real do formulário (não pelo breakpoint da janela): a 1280 px o
          // formulário divide a tela e 4 colunas fixas cortavam "Beleza/Moda" e "Casa/Cozinha".
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr))',
        }}
      >
        {OFFER_AUDIENCES.map((key) => {
          const a = offerStrings.audiences[key];
          const selected = key === current;
          const locked = aiLocked && key !== 'STANDARD';
          return (
            <Tooltip
              key={key}
              title={`${a.label}: ${locked ? offerStrings.form.aiRewriteLocked : a.subtitle}`}
              placement="top"
              enterDelay={400}
            >
              <Card
                variant="outlined"
                sx={{
                  borderColor: selected ? 'primary.main' : 'divider',
                  borderWidth: selected ? 2 : 1,
                  bgcolor: selected ? 'action.selected' : 'background.paper',
                  opacity: locked ? 0.6 : 1,
                  transition: 'border-color 150ms ease, background-color 150ms ease',
                }}
              >
                <CardActionArea
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={locked || undefined}
                  disabled={disabled || locked}
                  onClick={() => onChange(key)}
                  sx={{ p: 1.25, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, minWidth: 0 }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, color: selected ? 'primary.main' : 'text.primary' }}
                  >
                    <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}><AppIcon icon={AUDIENCE_ICONS[key]} /></Box>
                    <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</Box>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, overflowWrap: 'anywhere' }}>{a.subtitle}</Typography>
                </CardActionArea>
              </Card>
            </Tooltip>
          );
        })}
      </Box>
      {aiLocked && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          <PlanAvailabilityBadges from="pro" />
          <Typography id={noteId} variant="caption" color="text.secondary" component="p">{offerStrings.form.aiRewriteLocked}</Typography>
        </Box>
      )}
    </Box>
  );
}
