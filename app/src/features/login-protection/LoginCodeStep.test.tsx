import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { LoginCodeStep } from './LoginCodeStep';

const future = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const challenge = (resendIn = 60) => ({ ticket: 't1', codeSent: true, codeExpiresAt: future(600), resendAvailableAt: future(resendIn) });
const apiError = (code: string, meta?: Record<string, unknown>) => Object.assign(new Error(code), { code, meta });

function setup(over: Partial<Parameters<typeof LoginCodeStep>[0]> = {}, mode: 'light' | 'dark' = 'light') {
  const props = {
    email: 'ana@x.com',
    challenge: challenge(),
    onVerify: vi.fn(async () => {}),
    onResend: vi.fn(async () => challenge()),
    onBack: vi.fn(),
    onExpired: vi.fn(),
    ...over,
  };
  renderWithTheme(<LoginCodeStep {...props} />, mode);
  return props;
}

describe('LoginCodeStep', () => {
  it.each(['light', 'dark'] as const)('foca o campo, aceita colar com espaço e confirma com 6 dígitos (%s)', async (mode) => {
    const p = setup({}, mode);
    const input = screen.getByLabelText(/Código de verificação/);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    const button = screen.getByRole('button', { name: 'Confirmar e entrar' });
    expect(button).toBeDisabled();
    await userEvent.click(input);
    await userEvent.paste('123 456');
    expect(input).toHaveValue('123456');
    await userEvent.click(button);
    expect(p.onVerify).toHaveBeenCalledWith('123456');
  });

  it('código errado: mensagem com tentativas restantes junto do campo e campo limpo', async () => {
    setup({ onVerify: vi.fn(async () => { throw apiError('LOGIN_CODE_INVALID', { attemptsLeft: 4 }); }) });
    await userEvent.type(screen.getByLabelText(/Código de verificação/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e entrar' }));
    expect(await screen.findByText('Código incorreto. Restam 4 tentativas.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Código de verificação/)).toHaveValue('');
  });

  it('ticket vencido devolve para e-mail e senha', async () => {
    const p = setup({ onVerify: vi.fn(async () => { throw apiError('LOGIN_TICKET_INVALID'); }) });
    await userEvent.type(screen.getByLabelText(/Código de verificação/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e entrar' }));
    await waitFor(() => expect(p.onExpired).toHaveBeenCalledWith('A verificação expirou. Entre de novo com e-mail e senha.'));
  });

  it('reenviar: bloqueado com barra de espera até o horário do servidor', async () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Reenviar código' })).not.toBeInTheDocument();
    expect(screen.getByText('Você poderá pedir outro código em')).toBeInTheDocument();
  });

  it('reenvio liberado chama a API e mostra confirmação', async () => {
    const p = setup({ challenge: challenge(-1) });
    await userEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(p.onResend).toHaveBeenCalled();
    expect(await screen.findByText(/Enviamos um novo código/)).toBeInTheDocument();
  });

  it('voltar', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('button', { name: /Voltar e usar outra conta/ }));
    expect(p.onBack).toHaveBeenCalled();
  });
});
