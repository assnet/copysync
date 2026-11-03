import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  Badge, Box, ListItem, ListItemButton, ListItemIcon, ListItemText, MenuItem, MenuList, Popover, Tooltip,
  Typography, useMediaQuery,
} from '@mui/material';
import { AppIcon } from '@/components';
import { navigationStrings as s, type NavProduct } from '@/features/navigation';
import { NavItemBadge } from '../NavItemBadge';
import {
  NAV_ITEM_GAP, NAV_MOTION_MS, REDUCED_MOTION_QUERY, navButtonSx, navChildButtonSx, navChildIconSx, navIconSx,
} from './navStyles';

export interface CollapsedProductNavItemProps {
  product: NavProduct;
  activeChildKey?: string;
  onNavigate: (path: string) => void;
}

/**
 * Produto no sidebar recolhido (72px): só o ícone. Clique/Enter abre um Popover à direita com
 * nome, tagline e filhos (MenuList: setas, Home/End). Produto `soon` mostra Tooltip
 * "Em breve · tagline" e não abre nada. Ponto `primary` no ícone quando um filho está ativo.
 */
export function CollapsedProductNavItem({ product, activeChildKey, onNavigate }: CollapsedProductNavItemProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const open = Boolean(anchorEl);
  const hasActiveChild = activeChildKey != null;

  const icon = <AppIcon icon={product.icon} size="md" />;
  const iconWithDot = hasActiveChild ? (
    <Badge variant="dot" color="primary" overlap="circular">{icon}</Badge>
  ) : icon;

  if (product.status === 'soon') {
    return (
      <ListItem disablePadding sx={{ mb: NAV_ITEM_GAP }}>
        <Tooltip title={s.soonWithTagline(product.tagline)} placement="right" describeChild>
          <ListItemButton
            component="div"
            role="button"
            aria-disabled="true"
            aria-label={s.aria.productSoon(product.label)}
            disableRipple
            sx={{ ...navButtonSx(true), opacity: 0.55, cursor: 'default', '&:hover': { bgcolor: 'transparent' } }}
          >
            <ListItemIcon sx={navIconSx(true)}>{icon}</ListItemIcon>
          </ListItemButton>
        </Tooltip>
      </ListItem>
    );
  }

  const openMenu = (el: HTMLElement) => setAnchorEl(el);
  const closeMenu = () => setAnchorEl(null);
  const handleClick = (e: MouseEvent<HTMLElement>) => openMenu(e.currentTarget);
  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      openMenu(e.currentTarget);
    }
  };
  const menuId = `nav-product-menu-${product.key}`;
  const accessibleName = hasActiveChild ? s.aria.productWithActiveChild(product.label) : product.label;

  return (
    <ListItem disablePadding sx={{ mb: NAV_ITEM_GAP }}>
      <Tooltip title={open ? '' : product.label} placement="right">
        <ListItemButton
          selected={hasActiveChild}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={accessibleName}
          sx={navButtonSx(true)}
        >
          <ListItemIcon sx={navIconSx(true)}>{iconWithDot}</ListItemIcon>
        </ListItemButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closeMenu}
        transitionDuration={reducedMotion ? 0 : NAV_MOTION_MS}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { ml: 1, minWidth: 240, maxWidth: 300, borderRadius: 2, border: '1px solid', borderColor: 'divider' } } }}
      >
        <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" noWrap>{product.label}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">{product.tagline}</Typography>
        </Box>
        <MenuList id={menuId} autoFocusItem={open} aria-label={product.label} sx={{ p: 1 }}>
          {product.children.map((child) => {
            const active = child.key === activeChildKey;
            return (
              <MenuItem
                key={child.key}
                selected={active}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  closeMenu();
                  onNavigate(child.path);
                }}
                sx={{ ...navChildButtonSx, mb: NAV_ITEM_GAP }}
              >
                <ListItemIcon sx={navChildIconSx}>
                  <AppIcon icon={child.icon} size="md" />
                </ListItemIcon>
                <ListItemText
                  primary={child.label}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: active ? 600 : 500, noWrap: true }}
                />
                {child.badge && <NavItemBadge badge={child.badge} />}
              </MenuItem>
            );
          })}
        </MenuList>
      </Popover>
    </ListItem>
  );
}
