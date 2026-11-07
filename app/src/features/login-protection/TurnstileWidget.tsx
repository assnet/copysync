import { useEffect, useRef, useState } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { TURNSTILE_ACTION } from './config';
import { loginProtectionStrings as S } from './strings';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | null = null;

/** Carrega o script da Cloudflare uma vez por página (`data-app`: não é injeção de extensão). */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.setAttribute('data-app', 'turnstile');
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => { scriptPromise = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  /** Token novo (string) ou vencido/limpo (null). */
  onToken: (token: string | null) => void;
  /** Mudar o valor reinicia o desafio (o token é de uso único: um por tentativa). */
  resetSignal: number;
}

/** Widget Turnstile em modo gerenciado, com tema e idioma do painel. */
export function TurnstileWidget({ siteKey, onToken, resetSignal }: TurnstileWidgetProps) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const boxRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then((api) => {
      if (cancelled || !boxRef.current) return;
      idRef.current = api.render(boxRef.current, {
        sitekey: siteKey,
        action: TURNSTILE_ACTION,
        theme: mode,
        language: 'pt-br',
        size: 'flexible',
        callback: (t: string) => onTokenRef.current(t),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => { onTokenRef.current(null); return false; },
      });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current);
      idRef.current = null;
    };
  }, [siteKey, mode]);

  useEffect(() => {
    if (resetSignal === 0 || !idRef.current || !window.turnstile) return;
    onTokenRef.current(null);
    window.turnstile.reset(idRef.current);
  }, [resetSignal]);

  return (
    <Box role="group" aria-label={S.captchaLabel} sx={{ minHeight: 65, mb: 2 }}>
      <div ref={boxRef} />
      {failed && (
        <Typography role="alert" variant="body2" color="error.main">{S.captchaLoadFailed}</Typography>
      )}
    </Box>
  );
}
