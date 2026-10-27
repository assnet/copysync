import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ALL_PRIVACY_FLAGS, PRIVACY_SCREENS, isPrivacyFlag, type PrivacyFlag, type PrivacyScreenId } from './privacyFlags';

/** Preferência por navegador (não é dado do tenant): localStorage, sempre com try/catch. */
const STORAGE_KEY = 'privacy.blur';

export function readStoredFlags(): Set<PrivacyFlag> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(isPrivacyFlag) : []);
  } catch {
    return new Set();
  }
}

export function writeStoredFlags(flags: ReadonlySet<PrivacyFlag>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...flags]));
  } catch {
    // sem armazenamento: a preferência vale só nesta sessão da aba
  }
}

interface PrivacyContextValue {
  flags: ReadonlySet<PrivacyFlag>;
  /** Alguma flag ligada (indicador no menu). */
  active: boolean;
  isBlurred: (flag: PrivacyFlag) => boolean;
  setFlag: (flag: PrivacyFlag, on: boolean) => void;
  setScreen: (screen: PrivacyScreenId, on: boolean) => void;
  setAll: (on: boolean) => void;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<ReadonlySet<PrivacyFlag>>(readStoredFlags);
  const [dialogOpen, setDialogOpen] = useState(false);

  const update = useCallback((mutate: (next: Set<PrivacyFlag>) => void) => {
    setFlags((prev) => {
      const next = new Set(prev);
      mutate(next);
      writeStoredFlags(next);
      return next;
    });
  }, []);

  const value = useMemo<PrivacyContextValue>(() => ({
    flags,
    active: flags.size > 0,
    isBlurred: (flag) => flags.has(flag),
    setFlag: (flag, on) => update((next) => { if (on) next.add(flag); else next.delete(flag); }),
    setScreen: (screen, on) => update((next) => {
      for (const f of PRIVACY_SCREENS.find((s) => s.id === screen)?.flags ?? []) {
        if (on) next.add(f.id); else next.delete(f.id);
      }
    }),
    setAll: (on) => update((next) => { for (const f of ALL_PRIVACY_FLAGS) { if (on) next.add(f); else next.delete(f); } }),
    dialogOpen,
    openDialog: () => setDialogOpen(true),
    closeDialog: () => setDialogOpen(false),
  }), [flags, dialogOpen, update]);

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error('usePrivacy deve ser usado dentro de PrivacyProvider');
  return ctx;
}

/** Fora do provider (testes, prévias) devolve false: a tela nunca quebra por falta de contexto. */
export function useBlur(flag: PrivacyFlag): boolean {
  const ctx = useContext(PrivacyContext);
  return ctx?.flags.has(flag) ?? false;
}
