import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';

const svc = vi.hoisted(() => ({ getAccess: vi.fn() }));
vi.mock('@/services/saver.service', () => ({ saverService: svc }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));

import { SaverRoute } from './SaverRoute';
import { resetSaverAccessCache } from '../hooks/useSaverAccess';

function renderAt(mode: 'light' | 'dark' = 'light') {
  return renderWithTheme(
    <MemoryRouter initialEntries={['/saver']}>
      <Routes>
        <Route element={<SaverRoute />}>
          <Route path="/saver" element={<p>saver</p>} />
        </Route>
        <Route path="/settings/subscription" element={<p>assinatura</p>} />
      </Routes>
    </MemoryRouter>,
    mode,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSaverAccessCache();
});

describe('SaverRoute (audiência)', () => {
  it.each(['light', 'dark'] as const)('visível abre a tela (%s)', async (mode) => {
    svc.getAccess.mockResolvedValue({ visible: true });
    renderAt(mode);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('saver')).toBeInTheDocument();
  });

  it('fora da audiência vai para a assinatura (sem laço no início)', async () => {
    svc.getAccess.mockResolvedValue({ visible: false });
    renderAt();
    expect(await screen.findByText('assinatura')).toBeInTheDocument();
  });

  it('erro na consulta fecha e sai do cache', async () => {
    svc.getAccess.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ visible: true });
    const first = renderAt();
    expect(await screen.findByText('assinatura')).toBeInTheDocument();
    first.unmount();
    renderAt();
    expect(await screen.findByText('saver')).toBeInTheDocument();
    expect(svc.getAccess).toHaveBeenCalledTimes(2);
  });
});
