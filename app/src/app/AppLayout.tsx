import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Drawer, AppBar, Toolbar, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, IconButton, Avatar,
  Divider, Chip, Menu, MenuItem, Tooltip, alpha, useTheme,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DevicesIcon from '@mui/icons-material/Devices';
import LogoutIcon from '@mui/icons-material/Logout';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useColorMode } from '@/contexts/ThemeContext';

const DRAWER_WIDTH = 248;

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Sessões', path: '/sessions', icon: <DevicesIcon /> },
  { label: 'Chat', path: '/chat', icon: <ForumOutlinedIcon /> },
];

// Itens futuros — desabilitados por ora, só para estrutura visual
const NAV_FUTURE = [
  { label: 'Contatos', path: '/contacts' },
  { label: 'Campanhas', path: '/campaigns' },
  { label: 'Flows', path: '/flows' },
  { label: 'Automação', path: '/automation' },
  { label: 'Assistentes', path: '/assistants' },
  { label: 'Métricas', path: '/metrics' },
];

function NavLogo() {
  return (
    <Box sx={{ px: 2.5, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '10px',
          background: 'linear-gradient(135deg, #4f70e0 0%, #7c3aed 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: 16, lineHeight: 1 }}>W</Typography>
      </Box>
      <Typography variant="h6" fontWeight={800} letterSpacing={-0.5}>
        Washoot
      </Typography>
    </Box>
  );
}

interface DrawerContentProps {
  onClose?: () => void;
}

function DrawerContent({ onClose }: DrawerContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const theme = useTheme();

  const handleNav = (path: string) => {
    navigate(path);
    onClose?.();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <NavLogo />
      <Divider />

      {/* Navegação principal */}
      <Box sx={{ flex: 1, py: 1.5, overflowY: 'auto' }}>
        <Typography
          variant="caption"
          sx={{ px: 2.5, mb: 0.5, display: 'block', color: 'text.disabled', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}
        >
          Menu
        </Typography>
        <List disablePadding sx={{ px: 1 }}>
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path;
            return (
              <ListItem key={item.path} disablePadding sx={{ mb: 0.25 }}>
                <ListItemButton
                  selected={active}
                  onClick={() => handleNav(item.path)}
                  sx={{ py: 1, px: 1.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 36, '& svg': { fontSize: 20 } }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: active ? 600 : 500 }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>

        {/* Em breve */}
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
      </Box>

      <Divider />

      {/* Rodapé do drawer — usuário + logout */}
      <Box sx={{ p: 1.5 }}>
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
            }}
          >
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {user?.email ?? '—'}
            </Typography>
            <Typography variant="caption" color="text.disabled" noWrap>
              {user?.isSuperAdmin ? 'Super Admin' : 'Usuário'}
            </Typography>
          </Box>
        </Box>
        <ListItemButton onClick={handleLogout} sx={{ borderRadius: 2, px: 1.5, py: 0.75 }}>
          <ListItemIcon sx={{ minWidth: 32, '& svg': { fontSize: 18 } }}>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText
            primary="Sair"
            primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
          />
        </ListItemButton>
      </Box>
    </Box>
  );
}

export function AppLayout() {
  const { activeTenantName, tenants, switchTenant } = useTenant();
  const { mode, toggleColorMode } = useColorMode();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* AppBar mobile */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{ display: { sm: 'none' }, zIndex: (t) => t.zIndex.drawer + 1 }}
      >
        <Toolbar>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" fontWeight={800} sx={{ flex: 1 }}>
            Washoot
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
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
        open
      >
        <DrawerContent />
      </Drawer>

      {/* Drawer mobile */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { xs: 'block', sm: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
      >
        <DrawerContent onClose={() => setMobileOpen(false)} />
      </Drawer>

      {/* Conteúdo principal */}
      <Box
        component="main"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', mt: { xs: '56px', sm: 0 } }}
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
              {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
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
                icon={tenants.length > 1 ? <SwapHorizIcon /> : undefined}
                onClick={tenants.length > 1 ? (e) => setAnchorEl(e.currentTarget) : undefined}
                clickable={tenants.length > 1}
              />
              <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
                {tenants.map((t) => (
                  <MenuItem
                    key={t.id}
                    selected={t.id === localStorage.getItem('activeTenantId')}
                    onClick={async () => {
                      await switchTenant(t.id);
                      setAnchorEl(null);
                    }}
                  >
                    {t.name}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
        </Box>

        {/* Conteúdo da página */}
        <Box sx={{ flex: 1, p: { xs: 2, sm: 3, md: 4 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}

