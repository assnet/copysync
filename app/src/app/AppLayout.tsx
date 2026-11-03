import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Drawer, AppBar, Toolbar, List, Typography, IconButton, Avatar,
  Divider, Chip, Menu, MenuItem, Tooltip, alpha, useTheme,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  ArrowLeftRight, ChevronLeft, ChevronRight, LogOut, Menu as MenuIcon, Moon, Sun,
} from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, PrivacyDialog, privacyStrings, useBlur, usePrivacy } from '@/features/privacy';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useColorMode } from '@/contexts/ThemeContext';
import { useUiGuards } from '@/security/useUiGuards';
import { OutgoingMediaProvider } from '@/features/chat/media/OutgoingMediaProvider';
import { VoiceRecorderHost } from '@/features/chat/media/VoiceRecorderProvider';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import {
  buildNavigation, isNavAction, navigationStrings, useNavigationState,
  type NavLink, type NavigationModel, type NavigationState,
} from '@/features/navigation';
import { NavLinkItem } from './nav/NavLinkItem';
import { ProductNavItem } from './nav/ProductNavItem';
import { CollapsedProductNavItem } from './nav/CollapsedProductNavItem';
import { navSectionTitleSx } from './nav/navStyles';

const DRAWER_WIDTH = 272;
const DRAWER_WIDTH_COLLAPSED = 72;
const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore storage errors
  }
}

interface DrawerContentProps {
  model: NavigationModel;
  nav: NavigationState;
  /** Drawer que renderiza: ids de `aria-controls` ficam únicos entre desktop e mobile. */
  idPrefix: 'desktop' | 'mobile';
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}

function DrawerContent({ model, nav, idPrefix, collapsed = false, onToggleCollapse, onClose }: DrawerContentProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const theme = useTheme();
  const privacy = usePrivacy();
  const blurUser = useBlur('layout.userIdentity');
  const blurAvatarSx = blurUser ? { filter: 'blur(4px)' } : undefined;

  // Navegar (ou abrir o diálogo de privacidade) fecha o drawer mobile; expandir/recolher produto não.
  const handleNav = (path: string) => {
    navigate(path);
    onClose?.();
  };
  const handlePrivacy = () => {
    onClose?.();
    privacy.openDialog();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const activeLinkKey = nav.active?.link.key;
  const activeProductKey = nav.active?.product?.key;
  const userEmail = user?.email ?? navigationStrings.user.noEmail;
  const userRole = user?.isSuperAdmin ? navigationStrings.user.superAdmin : navigationStrings.user.regular;
  const userInitial = user?.name?.[0]?.toUpperCase() ?? navigationStrings.user.fallbackInitial;

  const sectionTitle = (title: string) =>
    collapsed ? (
      <Divider sx={{ mx: 1.5, my: 1 }} aria-hidden />
    ) : (
      <Typography variant="caption" sx={navSectionTitleSx}>{title}</Typography>
    );

  const renderLink = (link: NavLink) => (
    <NavLinkItem
      key={link.key}
      entry={link}
      active={link.key === activeLinkKey}
      collapsed={collapsed}
      onClick={() => handleNav(link.path)}
    />
  );

  const avatar = (
    <Avatar sx={{ width: 30, height: 30, bgcolor: 'primary.main', fontSize: 13, fontWeight: 700, flexShrink: 0, ...blurAvatarSx }}>
      {userInitial}
    </Avatar>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Logo + botão recolher/expandir na mesma linha */}
      <Box
        sx={{
          px: collapsed ? 1 : 2,
          minHeight: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <BrandLogo size={collapsed ? 32 : 40} />
          {!collapsed && (
            <Typography variant="h6" fontWeight={800} letterSpacing={-0.5} noWrap>
              {APP_NAME}
            </Typography>
          )}
        </Box>
        {onToggleCollapse && !collapsed && (
          <Tooltip title={navigationStrings.collapseMenu} placement="right">
            <IconButton size="small" onClick={onToggleCollapse} aria-label={navigationStrings.collapseMenu} sx={{ border: '1px solid', borderColor: 'divider' }}>
              <AppIcon icon={ChevronLeft} size="sm" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {onToggleCollapse && collapsed && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pb: 0.75 }}>
          <Tooltip title={navigationStrings.expandMenu} placement="right">
            <IconButton size="small" onClick={onToggleCollapse} aria-label={navigationStrings.expandMenu} sx={{ border: '1px solid', borderColor: 'divider' }}>
              <AppIcon icon={ChevronRight} size="sm" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Divider />

      {/* Navegação principal: global → produtos → plataforma. tabIndex -1: Chrome foca o
          contêiner rolável. Fade no rodapé avisa que há mais itens quando a altura não basta. */}
      <Box
        component="nav"
        aria-label={navigationStrings.aria.mainNav}
        tabIndex={-1}
        sx={{
          flex: 1,
          pt: 1,
          // pb = altura do fade: quando tudo cabe, o degradê só toca o padding, nunca um item.
          pb: 2.5,
          overflowY: 'auto',
          overflowX: 'hidden',
          outline: 'none',
          maskImage: 'linear-gradient(to bottom, #000 calc(100% - 20px), transparent)',
        }}
      >
        <List disablePadding sx={{ px: 1 }}>
          {model.top.map(renderLink)}
        </List>

        {sectionTitle(navigationStrings.sections.products)}
        <List disablePadding sx={{ px: 1 }}>
          {model.products.map((product) => {
            const childKey = product.key === activeProductKey ? activeLinkKey : undefined;
            return collapsed ? (
              <CollapsedProductNavItem
                key={product.key}
                product={product}
                activeChildKey={childKey}
                onNavigate={handleNav}
              />
            ) : (
              <ProductNavItem
                key={product.key}
                product={product}
                expanded={nav.isExpanded(product.key)}
                activeChildKey={childKey}
                idPrefix={idPrefix}
                onToggle={nav.toggle}
                onNavigate={handleNav}
              />
            );
          })}
        </List>

        {model.platform.length > 0 && (
          <>
            {sectionTitle(navigationStrings.sections.platform)}
            <List disablePadding sx={{ px: 1 }}>
              {model.platform.map(renderLink)}
            </List>
          </>
        )}
      </Box>

      <Divider />

      {/* Bloco inferior: planos, privacidade, configurações */}
      <List disablePadding sx={{ px: 1, py: 0.75 }}>
        {model.bottom.map((entry) =>
          isNavAction(entry) ? (
            <NavLinkItem
              key={entry.key}
              entry={entry}
              active={false}
              collapsed={collapsed}
              onClick={handlePrivacy}
              dotHint={privacy.active ? privacyStrings.menuActiveHint : undefined}
            />
          ) : renderLink(entry),
        )}
      </List>

      <Divider />

      {/* Rodapé compacto: avatar + e-mail/papel + Sair; versão abaixo */}
      <Box sx={{ px: collapsed ? 1 : 1.5, pt: 1, pb: 0.75 }}>
        {collapsed ? (
          <>
            <Tooltip
              title={
                <Box>
                  <Typography variant="caption" display="block"><Blurred when={blurUser} inline radius={4}>{userEmail}</Blurred></Typography>
                  <Typography variant="caption" color="inherit" sx={{ opacity: 0.8 }}>
                    <Blurred when={blurUser} inline radius={4}>{userRole}</Blurred>
                  </Typography>
                </Box>
              }
              placement="right"
            >
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.5 }}>{avatar}</Box>
            </Tooltip>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Tooltip title={navigationStrings.logout} placement="right">
                <IconButton size="small" onClick={handleLogout} aria-label={navigationStrings.logout}>
                  <AppIcon icon={LogOut} size="md" />
                </IconButton>
              </Tooltip>
            </Box>
          </>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              pl: 1,
              pr: 0.5,
              py: 0.5,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.06),
            }}
          >
            {avatar}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" color="text.secondary" noWrap display="block" sx={{ lineHeight: 1.3 }}>
                <Blurred when={blurUser} inline radius={4}>{userEmail}</Blurred>
              </Typography>
              <Typography variant="caption" color="text.disabled" noWrap display="block" sx={{ lineHeight: 1.3 }}>
                <Blurred when={blurUser} inline radius={4}>{userRole}</Blurred>
              </Typography>
            </Box>
            <Tooltip title={navigationStrings.logout}>
              <IconButton size="small" onClick={handleLogout} aria-label={navigationStrings.logout}>
                <AppIcon icon={LogOut} size="sm" />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        {/* Versão do painel — discreta, presente também no modo compacto */}
        <Tooltip title={`${APP_NAME} v${__APP_VERSION__}`} placement="right">
          <Typography
            variant="caption"
            color="text.disabled"
            align="center"
            sx={{ display: 'block', mt: 0.5, fontSize: 10, lineHeight: 1.2, letterSpacing: 0.3, userSelect: 'none' }}
          >
            {collapsed ? __APP_VERSION__ : `v${__APP_VERSION__}`}
          </Typography>
        </Tooltip>
      </Box>
    </Box>
  );
}

export function AppLayout() {
  // Barreiras de cópia e inspeção, aplicadas apenas na área autenticada.
  useUiGuards();

  const { activeTenantId, activeTenantName, tenants, switchTenant, loadTenants } = useTenant();
  const [switchError, setSwitchError] = useState(false);

  // The list lives only in memory: after a page reload it is empty and the switcher disappears.
  useEffect(() => {
    if (tenants.length === 0) void loadTenants().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { mode, toggleColorMode } = useColorMode();
  const theme = useTheme();

  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  // Modelo do menu e produtos expandidos vivem aqui: desktop e mobile (keepMounted)
  // compartilham o mesmo estado em vez de cada drawer ler o storage por conta própria.
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const navModel = useMemo(() => buildNavigation({ isSuperAdmin }), [isSuperAdmin]);
  const nav = useNavigationState(navModel, location.pathname);

  // Título da AppBar mobile: a tela atual orienta melhor que o nome do produto,
  // que já aparece no menu.
  const currentSectionLabel = nav.active?.link.label ?? nav.active?.product?.label ?? APP_NAME;

  // Título da aba do navegador acompanha a tela ativa.
  useEffect(() => {
    const section = nav.active?.link.label;
    document.title = section ? navigationStrings.documentTitle(section, APP_NAME) : APP_NAME;
  }, [nav.active?.link.label]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const drawerWidth = sidebarCollapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      persistSidebarCollapsed(next);
      return next;
    });
  };

  const drawerPaperSx = {
    width: drawerWidth,
    boxSizing: 'border-box' as const,
    overflowX: 'hidden',
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
  };

  const layout = (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* AppBar mobile */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{ display: { sm: 'none' }, zIndex: (t) => t.zIndex.drawer + 1 }}
      >
        <Toolbar>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label={navigationStrings.openMenu} sx={{ mr: 1 }}>
            <AppIcon icon={MenuIcon} size="lg" />
          </IconButton>
          <Typography variant="h6" fontWeight={800} sx={{ flex: 1 }} noWrap>
            {currentSectionLabel}
          </Typography>
          {activeTenantName && (
            <Chip label={activeTenantName} size="small" color="primary" variant="outlined" />
          )}
        </Toolbar>
      </AppBar>

      {/* Drawer desktop */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', sm: 'block' },
          width: drawerWidth,
          flexShrink: 0,
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
          '& .MuiDrawer-paper': drawerPaperSx,
        }}
        open
      >
        <DrawerContent model={navModel} nav={nav} idPrefix="desktop" collapsed={sidebarCollapsed} onToggleCollapse={handleToggleSidebar} />
      </Drawer>

      {/* Drawer mobile */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        // keepMounted evita remontar o menu a cada abertura no mobile
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', sm: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
      >
        <DrawerContent model={navModel} nav={nav} idPrefix="mobile" onClose={() => setMobileOpen(false)} />
      </Drawer>

      {/* Conteúdo principal */}
      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          // minWidth 0 é o que permite ao main encolher abaixo da largura intrínseca do
          // conteúdo. Sem isso, listas com texto longo esticavam a página para 849px
          // numa viewport de 390px e criavam rolagem horizontal no mobile.
          minWidth: 0,
          overflowX: 'hidden',
          // padding em vez de margin: a margem do main colapsava com a margem negativa
          // que as páginas usam para anular o padding do wrapper, e o conteúdo subia
          // para trás da AppBar fixa no mobile.
          pt: { xs: '56px', sm: 0 },
        }}
      >
        {/* Topbar desktop */}
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: 3,
            py: 1.25,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            gap: 1.5,
            minHeight: 52,
          }}
        >
          {/* Toggle de tema */}
          <Tooltip title={mode === 'dark' ? navigationStrings.theme.toLight : navigationStrings.theme.toDark}>
            <IconButton size="small" onClick={toggleColorMode} aria-label={mode === 'dark' ? navigationStrings.theme.toLight : navigationStrings.theme.toDark}>
              <AppIcon icon={mode === 'dark' ? Sun : Moon} size="md" />
            </IconButton>
          </Tooltip>

          {activeTenantName && (
            <>
              <Typography variant="caption" color="text.secondary">
                {navigationStrings.tenant.label}
              </Typography>
              <Chip
                label={activeTenantName}
                size="small"
                color="primary"
                variant="outlined"
                icon={tenants.length > 1 ? <AppIcon icon={ArrowLeftRight} size="sm" /> : undefined}
                onClick={tenants.length > 1 ? (e) => setAnchorEl(e.currentTarget) : undefined}
                clickable={tenants.length > 1}
              />
              <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
                {tenants.map((t) => (
                  <MenuItem
                    key={t.id}
                    selected={t.id === activeTenantId}
                    onClick={async () => {
                      setAnchorEl(null);
                      if (t.id === activeTenantId) return;
                      try {
                        await switchTenant(t.id);
                        // Recarga completa: páginas, SSE/WebSocket e rascunhos são por tenant.
                        window.location.assign('/dashboard');
                      } catch {
                        setSwitchError(true);
                      }
                    }}
                  >
                    {t.name}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
          <Snackbar open={switchError} autoHideDuration={6000} onClose={() => setSwitchError(false)}>
            <Alert severity="error" variant="filled" onClose={() => setSwitchError(false)}>
              {navigationStrings.tenant.switchError}
            </Alert>
          </Snackbar>
        </Box>

        {/* Conteúdo da página */}
        <Box sx={{ flex: 1, p: { xs: 2, sm: 3, md: 4 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );

  // Envio de mídia e gravador de voz acima das rotas: sair da tela do chat não cancela envio
  // nem gravação (a gravação vira rascunho da conversa). Logout e troca de tenant limpam tudo.
  return (
    <OutgoingMediaProvider>
      <VoiceRecorderHost>{layout}</VoiceRecorderHost>
      <PrivacyDialog />
    </OutgoingMediaProvider>
  );
}

