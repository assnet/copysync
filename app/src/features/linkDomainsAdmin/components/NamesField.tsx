import { useState } from 'react';
import { Autocomplete, Chip, TextField } from '@mui/material';
import { mergeReservedNames } from '../rules';
import { linkDomainsAdminStrings } from '../strings';

const t = linkDomainsAdminStrings.form;

interface Props {
  label: string;
  helper: string;
  tooManyMessage: string;
  value: string[];
  onChange: (names: string[]) => void;
  /** Registra quem converte o texto pendente ao salvar (devolve a lista ou `null` se inválido). */
  flushRef?: { current: (() => string[] | null) | null };
}

/**
 * Lista de nomes como chips (reservados ou especiais): digitar e teclar Enter, espaço, vírgula
 * ou `;` vira chip normalizado; nome inválido mostra o erro no campo.
 */
export function NamesField({ label, helper, tooManyMessage, value, onChange, flushRef }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (raw: string): string[] | null => {
    const r = mergeReservedNames(value, raw);
    if (!r.ok) {
      setError('invalid' in r ? t.reservedInvalid(r.invalid) : tooManyMessage);
      return null;
    }
    setError(null);
    onChange(r.names);
    setInput('');
    return r.names;
  };

  if (flushRef) flushRef.current = () => (input.trim() ? add(input) : value);

  return (
    <Autocomplete<string, true, false, true>
      multiple
      freeSolo
      options={[]}
      value={value}
      inputValue={input}
      onInputChange={(_, v, reason) => {
        if (reason === 'reset') return;
        if (/[\s,;]$/.test(v)) add(v);
        else setInput(v);
      }}
      onChange={(_, next, reason) => {
        if (reason === 'createOption') {
          add(String(next[next.length - 1] ?? ''));
          return;
        }
        setError(null);
        onChange(next.map(String));
      }}
      renderTags={(items, getTagProps) =>
        items.map((name, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return <Chip key={key} label={name} size="small" {...tagProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length ? undefined : t.reservedPlaceholder}
          error={Boolean(error)}
          helperText={error ?? helper}
          onBlur={() => {
            if (input.trim()) add(input);
          }}
        />
      )}
    />
  );
}
