import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Alert, IconButton, Snackbar, Tooltip } from '@mui/material';
import { Check, Copy } from 'lucide-react';
import { AppIcon } from '@/components';
import { saverStrings } from '../../strings';

const t = saverStrings.groups.copyName;
const COPIED_MS = 2000;

/** Clipboard API; sem ela (contexto inseguro, navegador antigo) cai no `execCommand('copy')`. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // tenta o fallback abaixo
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('data-app', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand?.('copy')) throw new Error('copy failed');
  } finally {
    area.remove();
  }
}

interface Props {
  /** Nome real: é o que vai para a área de transferência, mesmo borrado na tela. */
  name: string;
  /** Modo privacidade: Tooltip e `aria-label` não mostram o nome. */
  hideName: boolean;
}

/** Copia o nome do grupo sem marcar/desmarcar a linha. */
export function CopyGroupNameButton({ name, hideName }: Props) {
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await copyText(name);
      setCopied(true);
      setToast('copied');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setToast('failed');
    }
  };

  return (
    <>
      <Tooltip title={copied ? t.copied : t.action}>
        <IconButton
          size="small"
          aria-label={hideName ? t.action : t.actionOf(name)}
          onClick={(e) => void onClick(e)}
          onMouseDown={(e) => e.stopPropagation()}
          sx={{ color: copied ? 'success.main' : 'text.secondary' }}
        >
          <AppIcon icon={copied ? Check : Copy} size="sm" />
        </IconButton>
      </Tooltip>
      <Snackbar
        open={toast !== null}
        autoHideDuration={toast === 'failed' ? 5000 : 2500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast === 'failed' ? 'error' : 'success'} variant="filled" onClose={() => setToast(null)} sx={{ width: '100%' }}>
          {toast === 'failed' ? t.failed : t.copied}
        </Alert>
      </Snackbar>
    </>
  );
}
