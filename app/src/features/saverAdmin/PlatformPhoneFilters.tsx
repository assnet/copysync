import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Box, IconButton, InputAdornment, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { AppIcon } from '@/components';
import { BRAZIL_DDDS, BRAZIL_DDI, COMMON_DDIS, countryCodeDraft, countryName, dddRegion, isCountryCode } from './phoneRegions';
import { NUMERIC } from './platformContactsStyle';
import { saverAdminStrings as s } from './strings';

interface Props {
  ddi: string;
  ddd: string;
  /**
   * Só o pedaço que muda; quem recebe aplica sobre o valor mais recente. Este campo não limpa o DDD ao trocar
   * o país: isso é da normalização dos filtros (`normalizePlatformFilters`), único lugar da regra.
   */
  onChange: (patch: { ddi: string } | { ddd: string }) => void;
}

/** Valor de ação do seletor (não é país). */
const OTHER = '__other__';
/** Espera antes de aplicar o código digitado (cada consulta vai para a auditoria). */
export const CUSTOM_DDI_DEBOUNCE_MS = 400;
/** Janela, após abrir "Outro código", em que perder o foco é efeito da abertura e não saída do usuário. */
export const OPEN_BLUR_GRACE_MS = 250;

const code = (text: string) => <Box component="span" sx={{ ...NUMERIC, fontWeight: 700, minWidth: '3.25em', display: 'inline-block' }}>{text}</Box>;

/**
 * País (DDI) e DDD. Países mais comuns numa lista (Brasil primeiro) e "Outro código…" para digitar qualquer
 * código de país; só código inteiro é aplicado. DDD habilita só com o Brasil.
 *
 * O campo digitado tem rascunho próprio. `emitted` guarda o último DDI que ESTE campo aplicou: mudança do
 * filtro igual a ele é eco (o rascunho fica); qualquer outra veio de fora (barra dos indicadores, "Limpar
 * filtros", reload) e o campo acompanha. Sair do campo sem código inteiro volta ao seletor: nunca fica texto
 * órfão nem o campo preso vazio.
 */
export function PlatformPhoneFilters({ ddi, ddd, onChange }: Props) {
  const listed = ddi === '' || COMMON_DDIS.includes(ddi);
  const [custom, setCustom] = useState(!listed);
  const [draft, setDraft] = useState(listed ? '' : ddi);
  const emitted = useRef<string | null>(null);
  /** Quando o campo abriu por "Outro código…" (para ignorar a perda de foco espúria da abertura). */
  const openedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const draftState = countryCodeDraft(draft);

  const emit = (next: string) => {
    emitted.current = next;
    onChangeRef.current({ ddi: next });
  };

  useEffect(() => {
    const own = emitted.current === ddi;
    emitted.current = null;
    if (own) return;
    const other = ddi !== '' && !COMMON_DDIS.includes(ddi);
    setCustom(other);
    setDraft(other ? ddi : '');
  }, [ddi]);

  // Só aplica o código digitado depois que ele assenta e é um código inteiro.
  useEffect(() => {
    if (!custom) return;
    const next = isCountryCode(draft) ? draft : '';
    if (next === ddi) return;
    const t = setTimeout(() => emit(next), CUSTOM_DDI_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `ddi` fora das dependências de propósito: o timer nasce da digitação, não do filtro aplicado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, custom]);

  /**
   * "Outro código…" só troca o seletor pelo campo DEPOIS que o menu termina de fechar: ao fechar, o menu
   * devolve o foco ao seletor, e trocar antes disso tirava o foco do campo recém-criado (que, vazio e sem
   * foco, voltava na hora para o seletor).
   */
  const wantCustom = useRef(false);
  const pick = (value: string) => {
    if (value === OTHER) wantCustom.current = true;
    else emit(value);
  };
  const enterCustom = () => {
    if (!wantCustom.current) return;
    wantCustom.current = false;
    openedAt.current = Date.now();
    setCustom(true);
    setDraft('');
    if (ddi) emit('');
  };
  const backToList = () => {
    setCustom(false);
    setDraft('');
    if (ddi) emit('');
  };
  /**
   * Ao sair do campo sem um código inteiro (vazio, pela metade ou inválido): volta ao seletor e o filtro
   * de país zera na hora, sem esperar o timer. País que está na lista também volta a aparecer no seletor.
   * Única exceção: perda de foco logo na abertura (o menu do seletor ainda devolvendo o foco) não fecha o
   * campo; o foco volta para ele.
   */
  const leaveField = () => {
    if (draftState !== 'valid') {
      if (Date.now() - openedAt.current < OPEN_BLUR_GRACE_MS) {
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      backToList();
    } else if (draft === ddi && COMMON_DDIS.includes(draft)) {
      setCustom(false);
      setDraft('');
    }
  };
  const brazil = ddi === BRAZIL_DDI;

  return (
    <>
      {custom ? (
        // "Sair do campo" = o foco deixar o campo inteiro: ir do texto para o botão de voltar (Tab) não conta,
        // senão o campo sumia com o foco dentro. `display: contents` mantém o campo como item da grade.
        <Box sx={{ display: 'contents' }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leaveField(); }}>
        <TextField
          size="small"
          label={s.filters.customDdi}
          placeholder={s.filters.customDdiPlaceholder}
          value={draft}
          autoFocus={draft === ''}
          inputRef={inputRef}
          onChange={(e) => setDraft(e.target.value.replace(/\D+/g, '').slice(0, 3))}
          error={draftState === 'invalid'}
          helperText={draftState === 'invalid' ? s.filters.customDdiInvalid : draftState === 'incomplete' ? s.filters.customDdiIncomplete : undefined}
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
        </Box>
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
              MenuProps: { PaperProps: { sx: { maxHeight: 360 } }, TransitionProps: { onExited: enterCustom } },
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
          onChange={(e) => onChange({ ddd: e.target.value })}
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
