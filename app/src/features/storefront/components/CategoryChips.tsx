import { Box, Chip, FormHelperText, Stack, Typography } from '@mui/material';
import { Check } from 'lucide-react';
import { AppIcon } from '@/components';
import { storefrontStrings } from '../strings';
import type { StorefrontCategory } from '../types';

const t = storefrontStrings.fields.categories;

export interface CategoryChipsProps {
  /** Catálogo da API (`overview.categories`, com rótulo pt-BR). */
  categories: StorefrontCategory[];
  /** Chaves escolhidas. */
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/** Liga/desliga de categorias; a ordem salva segue a do catálogo. */
export function CategoryChips({ categories, value, onChange, disabled }: CategoryChipsProps) {
  const chosen = new Set(value);
  const toggle = (key: string) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(categories.map((c) => c.key).filter((k) => next.has(k)));
  };

  return (
    <Box role="group" aria-label={t.label}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.4 }}>{t.label}</Typography>
      <FormHelperText sx={{ mt: 0, mb: 1 }}>{t.help}</FormHelperText>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        {categories.map((c) => {
          const selected = chosen.has(c.key);
          return (
            <Chip
              key={c.key}
              label={c.label}
              clickable
              disabled={disabled}
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              icon={selected ? <AppIcon icon={Check} size="sm" /> : undefined}
              aria-pressed={selected}
              onClick={() => toggle(c.key)}
            />
          );
        })}
      </Stack>
    </Box>
  );
}
