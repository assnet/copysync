import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { tenantService } from '@/services/tenant.service';
import { reactionDispatcher } from '@/features/chat/reactionDispatcher';
import { mediaAccountScope } from '@/features/chat/media/mediaAccountScope';
import type { TenantItem } from '@/types/api.types';

interface TenantState {
  activeTenantId: string | null;
  activeTenantName: string | null;
  tenants: TenantItem[];
  /**
   * `GET /tenants` já respondeu (com sucesso ou falha). Antes disso menu de produtos e guards
   * mostram carregamento: no reload a lista começa vazia e nenhum produto pode ser presumido.
   */
  tenantsLoaded: boolean;
}

interface TenantContextValue extends TenantState {
  loadTenants: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

function loadInitialState(): TenantState {
  return {
    activeTenantId: localStorage.getItem('activeTenantId'),
    activeTenantName: localStorage.getItem('activeTenantName'),
    tenants: [],
    tenantsLoaded: false,
  };
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TenantState>(loadInitialState);

  const loadTenants = useCallback(async () => {
    let tenants: TenantItem[];
    try {
      tenants = await tenantService.listTenants();
    } catch (err) {
      // Falha também encerra o carregamento: sem isso as rotas de produto ficariam presas no indicador.
      setState((prev) => ({ ...prev, tenantsLoaded: true }));
      throw err;
    }

    // Se não há tenant ativo e há tenants disponíveis, ativa o primeiro
    const activeTenantId =
      localStorage.getItem('activeTenantId') ?? (tenants[0]?.id ?? null);
    const activeTenant = tenants.find((t) => t.id === activeTenantId) ?? tenants[0] ?? null;

    if (activeTenant) {
      localStorage.setItem('activeTenantId', activeTenant.id);
      localStorage.setItem('activeTenantName', activeTenant.name);
    }

    setState({
      tenants,
      tenantsLoaded: true,
      activeTenantId: activeTenant?.id ?? null,
      activeTenantName: activeTenant?.name ?? null,
    });
  }, []);

  const switchTenant = useCallback(async (tenantId: string) => {
    // Nada agendado pode sair com o tenant novo para mensagem do anterior.
    reactionDispatcher.reset();
    mediaAccountScope.reset();
    const result = await tenantService.switchTenant(tenantId);

    // Novo token com contexto do tenant
    localStorage.setItem('accessToken', result.accessToken);
    localStorage.setItem('activeTenantId', result.tenantId);
    localStorage.setItem('activeTenantName', result.tenantName);

    setState((prev) => ({
      ...prev,
      activeTenantId: result.tenantId,
      activeTenantName: result.tenantName,
    }));
  }, []);

  return (
    <TenantContext.Provider value={{ ...state, loadTenants, switchTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant deve ser usado dentro de TenantProvider');
  return ctx;
}
