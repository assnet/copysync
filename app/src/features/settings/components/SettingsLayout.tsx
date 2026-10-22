import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Grid, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography,
} from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import { settingsStrings } from '../strings';

const t = settingsStrings.layout;

const SETTINGS_NAV = [
  { label: t.navAccount, path: '/settings/account', icon: <PersonOutlineIcon fontSize="small" /> },
  {
    label: t.navAffiliateCredentials,
    path: '/settings/affiliate-credentials',
    icon: <KeyOutlinedIcon fontSize="small" />,
  },
];

export function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        {t.title}
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={3}>
          <List disablePadding>
            {SETTINGS_NAV.map((item) => {
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
