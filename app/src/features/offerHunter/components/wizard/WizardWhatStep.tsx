import { useId } from 'react';
import { Alert, Box, ButtonBase, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Check } from 'lucide-react';
import { AppIcon, ToggleOption } from '@/components';
import type { HuntOptions, HuntPreset, HuntSourceOptions, MlHuntSort } from '../../types';
import { huntBrandName, offerHunterStrings as t, sourceStatusText } from '../../strings';
import { capabilitiesOf, hasSourceFilter, providerOf, sortInColumn } from '../../providers';
import type { FieldErrors, HuntWizardDraft } from './wizardDraft';
import { AiHint, FieldHeading, FieldTip } from './fields';

const w = t.wizard.what;
const tips = t.wizard.tips;

interface Props {
  draft: HuntWizardDraft;
  options: HuntOptions;
  errors: FieldErrors;
  onChange: (patch: Partial<HuntWizardDraft>) => void;
  onPreset: (key: HuntPreset) => void;
}

const mlSortLabel = (sort: string) => t.mlSorts[sort as MlHuntSort] ?? sort;

/**
 * Passo 1: nome, predefinição (1 clique), categoria, palavra-chave e os filtros da fonte que a loja tiver
 * (`capabilities.sourceFilters`): no Mercado Livre, ordem da busca, "Só com ganhos extras" e "Só mais vendidos".
 */
export function WizardWhatStep({ draft, options, errors, onChange, onPreset }: Props) {
  const theme = useTheme();
  const presetsId = useId();
  const { limits } = options;
  const provider = providerOf(options);
  const caps = capabilitiesOf(options, provider);
  const column = sortInColumn(provider);
  const hints = draft.ai.hints;
  const noCategories = options.categories.length === 0;
  const sourceMsg = options.sourceStatus !== 'OK' ? sourceStatusText(options.sourceStatus, provider) : '';
  // Mexer na fonte sai da predefinição (ela vira "Personalizada")
  const setSource = (patch: Partial<HuntSourceOptions>) => onChange({ sourceOptions: { ...draft.sourceOptions, ...patch }, preset: 'CUSTOM' });
  const sourceSort = draft.sourceOptions.sort ?? caps.defaultSort;

  return (
    <Stack spacing={2.5}>
      <TextField
        label={w.name}
        value={draft.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder={w.namePlaceholder}
        required
        fullWidth
        error={Boolean(errors.name)}
        helperText={errors.name ?? w.nameHelp(limits.nameMaxLength)}
        slotProps={{
          htmlInput: { maxLength: limits.nameMaxLength + 20 },
          input: hints.name !== undefined ? { endAdornment: <AiHint reason={hints.name} path="name" /> } : undefined,
        }}
      />

      <Box>
        <FieldHeading id={presetsId} label={w.preset} tip={tips.preset} />
        <Box
          role="radiogroup"
          aria-labelledby={presetsId}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(auto-fill, minmax(150px, 1fr))' }, gap: 1 }}
        >
          {options.presets.map((p) => {
            const selected = draft.preset === p.key;
            const label = t.presets[p.key];
            return (
              <ButtonBase
                key={p.key}
                role="radio"
                aria-checked={selected}
                onClick={() => onPreset(p.key)}
                sx={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left',
                  gap: 0.25, p: 1.25, minHeight: 72, borderRadius: 2, border: '1px solid',
                  borderColor: selected ? 'primary.main' : 'divider',
                  backgroundColor: selected ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.07) : 'transparent',
                  transition: 'border-color 150ms, background-color 150ms',
                  '&:hover': { borderColor: selected ? 'primary.main' : 'text.secondary' },
                  '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>{label.label}</Typography>
                  {selected && <Box component="span" sx={{ color: 'primary.main', display: 'inline-flex' }}><AppIcon icon={Check} size="sm" label={t.wizard.presetSelected} /></Box>}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>{label.hint}</Typography>
              </ButtonBase>
            );
          })}
        </Box>
        {column && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {t.wizard.sortHintLabel(t.sorts[draft.sort], huntBrandName(provider))}. {w.sortHint}
            <AiHint reason={hints.sort} path="sort" />
          </Typography>
        )}
      </Box>

      {!column && hasSourceFilter(caps, 'sort') && (
        <TextField
          select
          label={w.sourceSort}
          value={caps.sorts.includes(sourceSort) ? sourceSort : caps.defaultSort}
          onChange={(e) => setSource({ sort: e.target.value })}
          fullWidth
          helperText={w.sortHint}
          error={Boolean(errors['sourceOptions.sort'])}
          slotProps={{
            input: {
              endAdornment: (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', mr: 3 }}>
                  <AiHint reason={hints['sourceOptions.sort']} path="sourceOptions.sort" />
                  <FieldTip title={w.sourceSortTip} field={w.sourceSort} />
                </Box>
              ),
            },
          }}
        >
          {caps.sorts.map((s) => <MenuItem key={s} value={s}>{mlSortLabel(s)}</MenuItem>)}
        </TextField>
      )}

      {!column && (hasSourceFilter(caps, 'extraEarningsOnly') || hasSourceFilter(caps, 'bestSellersOnly')) && (
        <Stack spacing={1}>
          {hasSourceFilter(caps, 'extraEarningsOnly') && (
            <ToggleOption
              checked={draft.sourceOptions.extraEarningsOnly === true}
              onChange={(v) => setSource({ extraEarningsOnly: v ? true : null })}
              title={w.extraEarningsOnly}
              description={w.extraEarningsOnlyHint}
              badge={<AiHint reason={hints['sourceOptions.extraEarningsOnly']} path="sourceOptions.extraEarningsOnly" />}
            />
          )}
          {hasSourceFilter(caps, 'bestSellersOnly') && (
            <ToggleOption
              checked={draft.sourceOptions.bestSellersOnly === true}
              onChange={(v) => setSource({ bestSellersOnly: v ? true : null })}
              title={w.bestSellersOnly}
              description={w.bestSellersOnlyHint}
              badge={<AiHint reason={hints['sourceOptions.bestSellersOnly']} path="sourceOptions.bestSellersOnly" />}
            />
          )}
        </Stack>
      )}

      {sourceMsg && noCategories && <Alert severity="info">{sourceMsg}</Alert>}

      <Box>
        <TextField
          select
          label={w.category}
          value={draft.categoryId ?? ''}
          onChange={(e) => onChange({ categoryId: e.target.value || null })}
          disabled={noCategories}
          fullWidth
          error={Boolean(errors.categoryId)}
          helperText={errors.categoryId}
          slotProps={{
            select: { displayEmpty: true },
            inputLabel: { shrink: true },
            input: hints.categoryId !== undefined
              ? { endAdornment: <Box sx={{ display: 'inline-flex', mr: 3 }}><AiHint reason={hints.categoryId} path="categoryId" /></Box> }
              : undefined,
          }}
        >
          <MenuItem value="">{w.categoryAll}</MenuItem>
          {options.categories.map((c) => <MenuItem key={c.categoryId} value={c.categoryId}>{c.name}</MenuItem>)}
          {/* Categoria salva que a fonte não listou agora continua escolhida */}
          {draft.categoryId && !options.categories.some((c) => c.categoryId === draft.categoryId) && (
            <MenuItem value={draft.categoryId}>{t.wizard.categorySaved}</MenuItem>
          )}
        </TextField>

      </Box>

      <TextField
        label={w.keyword}
        value={draft.keyword}
        onChange={(e) => onChange({ keyword: e.target.value })}
        placeholder={w.keywordPlaceholder}
        fullWidth
        error={Boolean(errors.keyword)}
        helperText={errors.keyword ?? w.keywordHelp}
        slotProps={{
          htmlInput: { maxLength: limits.keywordMaxLength + 20 },
          input: {
            endAdornment: (
              <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                <AiHint reason={hints.keyword} path="keyword" />
                <FieldTip title={tips.keyword} field={w.keyword} />
              </Box>
            ),
          },
        }}
      />
    </Stack>
  );
}
