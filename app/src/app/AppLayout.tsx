import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Drawer, AppBar, Toolbar, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, IconButton, Avatar,
  Divider, Chip, Menu, MenuItem, Tooltip, alpha, useTheme,
  Snackbar,
  Alert,
  Badge,
} from '@mui/material';
import {
  ArrowLeftRight, Bot, ChevronLeft, ChevronRight, Crown, LayoutDashboard, LogOut, Menu as MenuIcon, MessagesSquare,
  EyeOff, Globe, Link2, Moon, Settings, Sun, Tag,
} from 'lucide-react';
import { AppIcon } from '@/components';
import { MODULE_ICONS } from '@/pages/modules';
import { Blurred, PrivacyDialog, privacyStrings, useBlur, usePrivacy } from '@/features/privacy';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useColorMode } from '@/contexts/ThemeContext';
import { useUiGuards } from '@/security/useUiGuards';
import { OutgoingMediaProvider } from '@/features/chat/media/OutgoingMediaProvider';
import { VoiceRecorderHost } from '@/features/chat/media/VoiceRecorderProvider';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { aiStrings } from '@/features/ai/strings';
import { plansStrings } from '@/features/plans/strings';
import { linkDomainsAdminStrings } from '@/features/linkDomainsAdmin/strings';
import { linkRotationStrings } from '@/features/linkRotation/strings';
import { NavItemBadge, NavItemTooltip } from './NavItemBadge';

const DRAWER_WIDTH = 248;
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

// `badge` (opcional): selo após o rótulo; no menu recolhido vai para o Tooltip do ícone.
const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: <AppIcon icon={LayoutDashboard} size="md" /> },
  { label: 'Chat', path: '/chat', icon: <AppIcon icon={MessagesSquare} size="md" /> },
  { label: 'Gerador de ofertas', path: '/offers', icon: <AppIcon icon={Tag} size="md" /> },
  { label: 'Monitoramento', path: '/monitoring', icon: <AppIcon icon={MODULE_ICONS.monitoring} size="md" /> },
  { label: linkRotationStrings.menuLabel, path: '/link-rotation', icon: <AppIcon icon={Link2} size="md" /> },
  { label: 'Espelhamento', path: '/mirroring', icon: <AppIcon icon={MODULE_ICONS.mirroring} size="md" /> },
  { label: 'Gestor de membros', path: '/members', icon: <AppIcon icon={MODULE_ICONS.members} size="md" /> },
  { label: 'Página de Ofertas', path: '/storefront', icon: <AppIcon icon={MODULE_ICONS.storefront} size="md" />, badge: plansStrings.badgeProfessional },
  { label: plansStrings.menuLabel, path: '/plans', icon: <AppIcon icon={Crown} size="md" /> },
  // Ação (abre o diálogo de privacidade), não rota — ver features/privacy
  { label: privacyStrings.menuLabel, action: 'privacy' as const, icon: <AppIcon icon={EyeOff} size="md" /> },
  { label: 'Configurações', path: '/settings/sessions', icon: <AppIcon icon={Settings} size="md" />, matchPrefix: true },
];

/** Plataforma: só super admin vê (a rota também redireciona os demais). */
const NAV_ADMIN_ITEMS = [
  { label: aiStrings.admin.navLabel, path: '/admin/ai', icon: <AppIcon icon={Bot} size="md" /> },
  { label: linkDomainsAdminStrings.navLabel, path: '/admin/link-domains', icon: <AppIcon icon={Globe} size="md" /> },
];

// Itens futuros ("Em breve") — ocultos do menu até cada módulo existir. Para reativar, descomente
// este array e a seção "Em breve" no drawer (ver docs/produto-roadmap.md para a ordem).
// const NAV_FUTURE = [
//   { label: 'Contatos', path: '/contacts' },
//   { label: 'Campanhas', path: '/campaigns' },
//   { label: 'Flows', path: '/flows' },
//   { label: 'Automação', path: '/automation' },
//   { label: 'Assistentes', path: '/assistants' },
//   { label: 'Métricas', path: '/metrics' },
// ];

function NavLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <Box
      sx={{
        px: collapsed ? 1.5 : 2.5,
        py: 2.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 0.5,
        minHeight: 72,
      }}
    >
      <BrandLogo size={collapsed ? 36 : 44} />
      {!collapsed && (
        <Typography variant="h6" fontWeight={800} letterSpacing={-0.5} noWrap>
          {APP_NAME}
        </Typography>
      )}
    </Box>
  );
}

interface DrawerContentProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}

function DrawerContent({ collapsed = false, onToggleCollapse, onClose }: DrawerContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const theme = useTheme();
  const privacy = usePrivacy();
  const blurUser = useBlur('layout.userIdentity');
  const blurAvatarSx = blurUser ? { filter: 'blur(4px)' } : undefined;

  const handleNav = (path: string) => {
    navigate(path);
    onClose?.();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Alvo de toque de 44px no mobile (recomendação de acessibilidade) e um indicador
  // lateral no item ativo, que o `selected` do MUI sozinho não deixa evidente.
  const navButtonSx = {
    borderRadius: 2,
    position: 'relative' as const,
    minHeight: { xs: 44, sm: 40 },
    ...(collapsed ? { py: 1.25, px: 1, justifyContent: 'center' } : { py: 1, px: 1.5 }),
    '&.Mui-selected::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 3,
      height: '60%',
      borderRadius: 4,
      bgcolor: 'primary.main',
    },
  };

  const navIconSx = collapsed
    ? { minWidth: 0, justifyContent: 'center', '& svg': { width: 22, height: 22 } }
    : { minWidth: 36, '& svg': { width: 20, height: 20 } };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box>
        <NavLogo collapsed={collapsed} />
        {onToggleCollapse && (
          <Box sx={{ display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end', px: 1, pb: 1 }}>
            <Tooltip title={collapsed ? 'Expandir menu' : 'Recolher menu'} placement="right">
              <IconButton
                size="small"
                onClick={onToggleCollapse}
                aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <AppIcon icon={collapsed ? ChevronRight : ChevronLeft} size="sm" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      <Divider />

      {/* Navegação principal */}
      <Box sx={{ flex: 1, py: 1.5, overflowY: 'auto', overflowX: 'hidden' }}>
        {!collapsed && (
          <Typography
            variant="caption"
            sx={{ px: 2.5, mb: 0.5, display: 'block', color: 'text.disabled', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}
          >
            Menu
          </Typography>
        )}
        <List disablePadding sx={{ px: 1 }}>
          {[...NAV_ITEMS, ...(user?.isSuperAdmin ? NAV_ADMIN_ITEMS : [])].map((item) => {
            const isAction = 'action' in item;
            const badge = 'badge' in item ? item.badge : undefined;
            const active = isAction
              ? false
              : 'matchPrefix' in item && item.matchPrefix
                ? location.pathname.startsWith('/settings')
                : location.pathname === item.path;
            const button = (
              <ListItemButton
                selected={active}
                onClick={() => (isAction ? privacy.openDialog() : handleNav(item.path))}
                sx={navButtonSx}
              >
                <ListItemIcon sx={navIconSx}>
                  {isAction && privacy.active ? (
                    <Badge variant="dot" color="primary" overlap="circular" title={privacyStrings.menuActiveHint}>{item.icon}</Badge>
                  ) : item.icon}
                </ListItemIcon>
                {!collapsed && (
                  // Com selo: rótulo pode quebrar e o selo desce para linha própria (não corta o rótulo).
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: active ? 600 : 500, noWrap: !badge, sx: badge ? { lineHeight: 1.3 } : undefined }}
                    secondary={badge ? <NavItemBadge badge={badge} stacked /> : undefined}
                    secondaryTypographyProps={{ component: 'div' }}
                    sx={badge ? { my: 0.25 } : undefined}
                  />
                )}
              </ListItemButton>
            );

            return (
              <ListItem key={'action' in item ? item.action : item.path} disablePadding sx={{ mb: 0.25 }}>
                {collapsed ? (
                  <Tooltip title={<NavItemTooltip label={item.label} badge={badge} />} placement="right">
                    {button}
                  </Tooltip>
                ) : (
                  button
                )}
              </ListItem>
            );
          })}
        </List>

        {/* Seção "Em breve" oculta (ver NAV_FUTURE no topo do arquivo).
        {!collapsed && (
          <>
            <Typography
              variant="caption"
              sx={{ px: 2.5, mt: 2, mb: 0.5, display: 'block', color: 'text.disabled', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}
            >
              Em breve
            </Typography>
            <List disablePadding sx={{ px: 1 }}>
              {NAV_FUTURE.map((item) => (
                <ListItem key={item.path} disablePadding sx={{ mb: 0.25 }}>
                  <ListItemButton disabled sx={{ py: 1, px: 1.5, opacity: 0.45 }}>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                    />
                    <Chip label="Em breve" size="small" sx={{ fontSize: 10, height: 18, opacity: 0.7 }} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        )}
        */}
      </Box>

      <Divider />

      {/* Rodapé do drawer — usuário + logout */}
      <Box sx={{ p: collapsed ? 1 : 1.5 }}>
        {collapsed ? (
          <Tooltip
            title={
              <Box>
                <Typography variant="caption" display="block"><Blurred when={blurUser} inline radius={4}>{user?.email ?? '—'}</Blurred></Typography>
                <Typography variant="caption" color="inherit" sx={{ opacity: 0.8 }}>
                  <Blurred when={blurUser} inline radius={4}>{user?.isSuperAdmin ? 'Super Admin' : 'Usuário'}</Blurred>
                </Typography>
              </Box>
            }
            placement="right"
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                py: 1,
                mb: 0.5,
              }}
            >
              <Avatar
                sx={{
                  width: 34,
                  height: 34,
                  bgcolor: 'primary.main',
                  fontSize: 14,
                  fontWeight: 700,
                  ...blurAvatarSx,
                }}
              >
                {user?.name?.[0]?.toUpperCase() ?? 'U'}
              </Avatar>
            </Box>
          </Tooltip>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 1.5,
              py: 1.25,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.06),
              mb: 0.5,
            }}
          >
            <Avatar
              sx={{
                width: 34,
                height: 34,
                bgcolor: 'primary.main',
                fontSize: 14,
                fontWeight: 700,
                flexShrink: 0,
                ...blurAvatarSx,
              }}
            >
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" color="text.secondary" noWrap display="block">
                <Blurred when={blurUser} inline radius={4}>{user?.email ?? '—'}</Blurred>
              </Typography>
              <Typography variant="caption" color="text.disabled" noWrap>
                <Blurred when={blurUser} inline radius={4}>{user?.isSuperAdmin ? 'Super Admin' : 'Usuário'}</Blurred>
              </Typography>
            </Box>
          </Box>
        )}

        {collapsed ? (
          <Tooltip title="Sair" placement="right">
            <ListItemButton
              onClick={handleLogout}
              sx={{ borderRadius: 2, py: 1, justifyContent: 'center' }}
            >
              <ListItemIcon sx={{ minWidth: 0 }}>
                <AppIcon icon={LogOut} size="md" />
              </ListItemIcon>
            </ListItemButton>
          </Tooltip>
        ) : (
          <ListItemButton onClick={handleLogout} sx={{ borderRadius: 2, px: 1.5, py: 0.75 }}>
            <ListItemIcon sx={{ minWidth: 32 }}>
              <AppIcon icon={LogOut} size="sm" />
            </ListItemIcon>
            <ListItemText
              primary="Sair"
              primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
            />
          </ListItemButton>
        )}

        {/* Versão do painel — discreta, presente também no modo compacto */}
        <Tooltip title={`${APP_NAME} v${__APP_VERSION__}`} placement="right">
          <Typography
            variant="caption"
            color="text.disabled"
            align="center"
            sx={{
              display: 'block',
              mt: 0.75,
              fontSize: 10,
              letterSpacing: 0.3,
              userSelect: 'none',
            }}
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

  // Título da AppBar mobile: a seção atual orienta melhor que o nome do produto,
  // que já aparece no menu.
  const currentSectionLabel =
    NAV_ITEMS.find((item) =>
      item.matchPrefix ? location.pathname.startsWith('/settings') : location.pathname === item.path,
    )?.label ?? APP_NAME;
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
          <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
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
        <DrawerContent collapsed={sidebarCollapsed} onToggleCollapse={handleToggleSidebar} />
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
        <DrawerContent onClose={() => setMobileOpen(false)} />
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
          <Tooltip title={mode === 'dark' ? 'Tema claro' : 'Tema escuro'}>
            <IconButton size="small" onClick={toggleColorMode}>
              <AppIcon icon={mode === 'dark' ? Sun : Moon} size="md" />
            </IconButton>
          </Tooltip>

          {activeTenantName && (
            <>
              <Typography variant="caption" color="text.secondary">
                Tenant:
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
              Não foi possível trocar de tenant. Tente novamente.
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

