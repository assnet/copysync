import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ProductHomeRedirect, ProductRoute } from './ProductRoute';

const tenant = vi.hoisted(() => ({
  value: { activeTenantId: 't1', tenantsLoaded: false, tenants: [] as Array<{ id: string; products?: string[] }> },
}));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.value }));

function renderAt(mode: 'light' | 'dark' = 'light') {
  return renderWithTheme(
    <MemoryRouter initialEntries={['/offers']}>
      <Routes>
        <Route element={<ProductRoute product="AFFILIATES" />}>
          <Route path="/offers" element={<p>tela de ofertas</p>} />
        </Route>
        <Route path="/affiliates/plans" element={<p>vitrine</p>} />
      </Routes>
    </MemoryRouter>,
    mode,
  );
}

describe('ProductRoute', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`lista carregando: indicador, nunca Afiliados presumido (${mode})`, () => {
      tenant.value = { activeTenantId: 't1', tenantsLoaded: false, tenants: [] };
      renderAt(mode);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('tela de ofertas')).toBeNull();
      expect(screen.queryByText('vitrine')).toBeNull();
    });
  }

  it('tenant carregado sem o campo (legado) abre a tela', () => {
    tenant.value = { activeTenantId: 't1', tenantsLoaded: true, tenants: [{ id: 't1' }] };
    renderAt();
    expect(screen.getByText('tela de ofertas')).toBeInTheDocument();
  });

  it('sem o produto vai para a vitrine dele', () => {
    tenant.value = { activeTenantId: 't1', tenantsLoaded: true, tenants: [{ id: 't1', products: ['SAVER'] }] };
    renderAt('dark');
    expect(screen.getByText('vitrine')).toBeInTheDocument();
  });
});

describe('ProductHomeRedirect', () => {
  function renderHome() {
    return renderWithTheme(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route index element={<ProductHomeRedirect />} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
          <Route path="/settings/subscription" element={<p>assinatura</p>} />
          <Route path="/saver" element={<p>saver</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('carregando: indicador', () => {
    tenant.value = { activeTenantId: 't1', tenantsLoaded: false, tenants: [] };
    renderHome();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('com Afiliados: dashboard', () => {
    tenant.value = { activeTenantId: 't1', tenantsLoaded: true, tenants: [{ id: 't1', products: ['AFFILIATES', 'CHAT'] }] };
    renderHome();
    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });

  it('só-Saver: início no Saver', () => {
    tenant.value = { activeTenantId: 't1', tenantsLoaded: true, tenants: [{ id: 't1', products: ['SAVER'] }] };
    renderHome();
    expect(screen.getByText('saver')).toBeInTheDocument();
  });

  it('sem produto: assinatura', () => {
    tenant.value = { activeTenantId: 't1', tenantsLoaded: true, tenants: [{ id: 't1', products: [] }] };
    renderHome();
    expect(screen.getByText('assinatura')).toBeInTheDocument();
  });
});
