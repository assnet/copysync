import { Button, type ButtonProps } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { AFFILIATE_CREDENTIALS_PATH } from '@/features/navigation/model';
import { connectActionLabel } from '../linkErrors';

export interface ConnectStoreActionProps {
  /** Código do erro: escolhe o rótulo ("Conectar Shopee", "Revisar conexão"…). */
  code?: string | null;
  /** `meta` do erro (usa `meta.provider`). */
  meta?: unknown;
  size?: ButtonProps['size'];
  color?: ButtonProps['color'];
  variant?: ButtonProps['variant'];
}

/** Caminho das credenciais com `returnTo` = tela atual (caminho + query), para voltar depois de conectar. */
export function credentialsPathFor(pathname: string, search = ''): string {
  return `${AFFILIATE_CREDENTIALS_PATH}?${new URLSearchParams({ returnTo: `${pathname}${search}` }).toString()}`;
}

/** Botão para conectar/revisar a loja nas credenciais de afiliado e voltar à tela atual. */
export function ConnectStoreAction({ code, meta, size = 'small', color = 'inherit', variant = 'text' }: ConnectStoreActionProps) {
  const { pathname, search } = useLocation();
  return (
    <Button component={RouterLink} to={credentialsPathFor(pathname, search)} size={size} color={color} variant={variant}>
      {connectActionLabel(code, meta)}
    </Button>
  );
}
