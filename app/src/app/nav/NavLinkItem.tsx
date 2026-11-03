import { Badge, ListItem, ListItemButton, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import { AppIcon } from '@/components';
import type { NavAction, NavLink } from '@/features/navigation';
import { NavItemBadge, NavItemTooltip } from '../NavItemBadge';
import { NAV_ITEM_GAP, navButtonSx, navIconSx } from './navStyles';

interface NavLinkItemProps {
  entry: NavLink | NavAction;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  /** Ponto no ícone (ex.: privacidade ativa) com dica acessível. */
  dotHint?: string;
}

/** Item de primeiro nível (Dashboard, Plataforma, bloco inferior). Selo sempre inline à direita. */
export function NavLinkItem({ entry, active, collapsed, onClick, dotHint }: NavLinkItemProps) {
  const badge = 'badge' in entry ? entry.badge : undefined;
  const icon = <AppIcon icon={entry.icon} size="md" />;
  const button = (
    <ListItemButton
      selected={active}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? entry.label : undefined}
      sx={navButtonSx(collapsed)}
    >
      <ListItemIcon sx={navIconSx(collapsed)}>
        {dotHint ? (
          <Badge variant="dot" color="primary" overlap="circular" title={dotHint}>{icon}</Badge>
        ) : icon}
      </ListItemIcon>
      {!collapsed && (
        <>
          <ListItemText
            primary={entry.label}
            primaryTypographyProps={{ variant: 'body2', fontWeight: active ? 600 : 500, noWrap: true }}
          />
          {badge && <NavItemBadge badge={badge} />}
        </>
      )}
    </ListItemButton>
  );

  return (
    <ListItem disablePadding sx={{ mb: NAV_ITEM_GAP }}>
      {collapsed ? (
        <Tooltip title={<NavItemTooltip label={entry.label} badge={badge} />} placement="right">
          {button}
        </Tooltip>
      ) : button}
    </ListItem>
  );
}
