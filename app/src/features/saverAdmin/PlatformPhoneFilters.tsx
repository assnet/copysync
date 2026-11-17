import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Box, IconButton, InputAdornment, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { AppIcon } from '@/components';
import { BRAZIL_DDDS, BRAZIL_DDI, COMMON_DDIS, countryName, dddRegion, isCountryCode } from './phoneRegions';
import { NUMERIC } from './platformContactsStyle';
import { saverAdminStrings as s } from './strings';

interface Props {
  ddi: string;
  ddd: string;
  /** Trocar o DDI sempre limpa o DDD (DDD só existe com o Brasil). */
  onChange: (next: { ddi: string; ddd: string }) => void;
}

/** Valor de ação do seletor (não é país). */
const OTHER = '__other__';
/** Espera antes de aplicar o código digitado (cada consulta vai para a auditoria). */
export const CUSTOM_DDI_DEBOUNCE_MS = 400;

const code = (text: string) => <Box component="span" sx={{ ...NUMERIC, fontWeight: 700, minWidth: '3.25em', display: 'inline-block' }}>{text}</Box>;

/**
 * País (DDI) e DDD. Países mais comuns numa lista (Brasil primeiro) e "Outro código…" para digitar qualquer
 * código de país; só código inteiro é aplicado. DDD habilita só com o Brasil.
 */
export function PlatformPhoneFilters({ ddi, ddd, onChange }: Props) {
  const listed = ddi === '' || COMMON_DDIS.includes(ddi);
  const [custom, setCustom] = useState(!listed);
  const [draft, setDraft] = useState(listed ? '' : ddi);
  const draftInvalid = draft !== '' && !isCountryCode(draft);

  // Filtro mudou por fora (barra dos indicadores, "Limpar filtros", reload): o campo acompanha.
  useEffect(() => {
    if (ddi === '') {
      // Vazio com código inteiro no campo = foi limpo por fora; código pela metade = ainda digitando.
      setDraft((d) => { if (isCountryCode(d)) { setCustom(false); return ''; } return d; });
      return;
    }
    if (!COMMON_DDIS.includes(ddi)) { setCustom(true); setDraft(ddi); return; }
    setCustom(false);
    setDraft('');
  }, [ddi]);

  // Só aplica o código digitado depois que ele assenta e é um código inteiro.
  useEffect(() => {
    if (!custom) return;
    const next = isCountryCode(draft) ? draft : '';
    if (next === ddi) return;
    const t = setTimeout(() => onChange({ ddi: next, ddd: '' }), CUSTOM_DDI_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, custom]);

  const pick = (value: string) => {
    if (value === OTHER) { setCustom(true); setDraft(''); if (ddi) onChange({ ddi: '', ddd: '' }); return; }
    onChange({ ddi: value, ddd: '' });
  };
  const backToList = () => { setCustom(false); setDraft(''); if (ddi) onChange({ ddi: '', ddd: '' }); };
  const brazil = ddi === BRAZIL_DDI;

  return (
    <>
      {custom ? (
        <TextField
          size="small"
          label={s.filters.customDdi}
          placeholder={s.filters.customDdiPlaceholder}
          value={draft}
          autoFocus={draft === ''}
          onChange={(e) => setDraft(e.target.value.replace(/\D+/g, '').slice(0, 3))}
          error={draftInvalid}
          helperText={draftInvalid ? s.filters.customDdiInvalid : undefined}
          inputProps={{ inputMode: 'numeric', 'aria-label': s.filters.customDdi }}
          InputLabelProps={{ shrink: true }}
          InputProps={{
            startAdornment: <InputAdornment position="start">+</InputAdornment>,
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title={s.filters.backToList} arrow>
                  <IconButton size="small" edge="end" aria-label={s.filters.backToList} onClick={backToList}><AppIcon icon={X} size="sm" /></IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          }}
        />
      ) : (
        <Tooltip title={s.filters.ddiHint} arrow placement="top">
          <TextField
            select
            size="small"
            label={s.filters.ddi}
            value={ddi}
            onChange={(e) => pick(e.target.value)}
            InputLabelProps={{ shrink: true }}
            SelectProps={{
              displayEmpty: true,
              MenuProps: { PaperProps: { sx: { maxHeight: 360 } } },
              renderValue: (v) => (v ? `+${String(v)} ${countryName(String(v))}` : s.filters.allCountries),
            }}
          >
            <MenuItem value="">{s.filters.allCountries}</MenuItem>
            {COMMON_DDIS.map((c) => (
              <MenuItem key={c} value={c} aria-label={`+${c} ${countryName(c)}`}>{code(`+${c}`)}{countryName(c)}</MenuItem>
            ))}
            <MenuItem value={OTHER} sx={{ color: 'primary.main' }}>{s.filters.otherDdi}</MenuItem>
          </TextField>
        </Tooltip>
      )}
      <Tooltip title={brazil ? s.filters.dddHint : s.filters.dddDisabledHint} arrow placement="top">
        <TextField
          select
          size="small"
          label={s.filters.ddd}
          value={brazil ? ddd : ''}
          disabled={!brazil}
          onChange={(e) => onChange({ ddi, ddd: e.target.value })}
          InputLabelProps={{ shrink: true }}
          SelectProps={{
            displayEmpty: true,
            MenuProps: { PaperProps: { sx: { maxHeight: 360 } } },
            renderValue: (v) => (v ? `${String(v)} ${dddRegion(String(v))}` : s.filters.allDdds),
          }}
        >
          <MenuItem value="">{s.filters.allDdds}</MenuItem>
          {BRAZIL_DDDS.map((d) => (
            <MenuItem key={d} value={d} aria-label={`${d} ${dddRegion(d)}`}>
              {code(d)}
              <Typography component="span" variant="body2" color="text.secondary">{dddRegion(d)}</Typography>
            </MenuItem>
          ))}
        </TextField>
      </Tooltip>
    </>
  );
}
