import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { storefrontStrings } from '../strings';
import { ColorField } from './ColorField';

const t = storefrontStrings.fields.colors;

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <ColorField label={t.primary} value={value} onChange={setValue} />;
}

const text = () => screen.getByRole('textbox', { name: t.primary });

describe('ColorField', () => {
  it('rejeita hex inválido', () => {
    renderWithTheme(<Controlled initial="#2563EB" />);
    expect(screen.queryByText(t.invalid)).not.toBeInTheDocument();
    for (const bad of ['#12345', '123456', '#GGGGGG', '#abc']) {
      fireEvent.change(text(), { target: { value: bad } });
      expect(screen.getByText(t.invalid)).toBeInTheDocument();
      expect(text()).toHaveAttribute('aria-invalid', 'true');
    }
  });

  it('aceita #rrggbb e normaliza para maiúsculo ao sair do campo', () => {
    renderWithTheme(<Controlled initial="#000000" />, 'dark');
    fireEvent.change(text(), { target: { value: '#a1b2c3' } });
    expect(screen.queryByText(t.invalid)).not.toBeInTheDocument();
    fireEvent.blur(text());
    expect(text()).toHaveValue('#A1B2C3');
  });

  it('o swatch atualiza o texto', () => {
    renderWithTheme(<Controlled initial="#000000" />);
    fireEvent.change(screen.getByLabelText(t.picker(t.primary)), { target: { value: '#ff0000' } });
    expect(text()).toHaveValue('#FF0000');
  });
});
