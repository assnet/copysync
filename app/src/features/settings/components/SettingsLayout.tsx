import type { ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Grid, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography,
} from '@mui/material';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PsychologyOutlinedIcon from '@mui/icons-material/PsychologyOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import { CreditCard } from 'lucide-react';
import { AppIcon } from '@/components';
import { subscriptionStrings } from '@/features/subscription/strings';
import { settingsStrings } from '../strings';
import { extensionStrings } from '@/features/extension/strings';
import { hasProduct, useProductAccess, type ProductKey } from '@/features/products';

const t = settingsStrings.layout;

/** `product`: item só aparece com o produto (lista carregada); a rota tem o mesmo guard (PROD-29). */
const SETTINGS_NAV: { label: string; path: string; icon: ReactNode; product?: ProductKey }[] = [
  { label: t.navSessions, path: '/settings/sessions', icon: <PhoneIphoneOutlinedIcon fontSize="small" /> },
  { label: subscriptionStrings.menuLabel, path: '/settings/subscription', icon: <AppIcon icon={CreditCard} size="md" /> },
  { label: t.navAccount, path: '/settings/account', icon: <PersonOutlineIcon fontSize="small" /> },
  { label: t.navAi, path: '/settings/ai', icon: <PsychologyOutlinedIcon fontSize="small" />, product: 'AFFILIATES' },
  { label: extensionStrings.nav.title, path: '/settings/extension', icon: <ExtensionOutlinedIcon fontSize="small" />, product: 'AFFILIATES' },
];

export function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loaded, products } = useProductAccess();
  const items = SETTINGS_NAV.filter((item) => !item.product || (loaded && hasProduct(products, item.product)));

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        {t.title}
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={3}>
          <List disablePadding>
            {items.map((item) => {
              const active = location.pathname.startsWith(item.path);
              return (
                <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    selected={active}
                    onClick={() => navigate(item.path)}
                    sx={{ borderRadius: 2, py: 1 }}
                  >
                    <ListItemIcon sx={{ minWidth: 32, color: active ? 'primary.main' : 'text.secondary' }}>
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
        </Grid>

        <Grid item xs={12} md={9}>
          <Outlet />
        </Grid>
      </Grid>
    </Box>
  );
}
