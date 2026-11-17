import { useEffect, useRef } from 'react';
import { Alert } from '@mui/material';

/**
 * Aviso do cursor inválido: aparece depois de a lista recarregar do início. Recebe o foco ao montar (o botão
 * "Carregar mais" que estava focado sumiu com a recarga), com `tabIndex={-1}` para não entrar no Tab.
 * O texto vem de quem usa (cada tela tem o seu `strings.ts`).
 */
export function CursorResetNotice({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <Alert ref={ref} severity="info" role="status" tabIndex={-1} sx={{ '&:focus': { outline: 'none' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>{message}</Alert>;
}
