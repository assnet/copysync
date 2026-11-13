import {
  Box, Chip, Collapse, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Tooltip, useMediaQuery,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { AppIcon } from '@/components';
import { navigationStrings as s, type NavProduct } from '@/features/navigation';
import { NavItemBadge } from '../NavItemBadge';
import {
  NAV_ITEM_GAP, NAV_MOTION_MS, REDUCED_MOTION_QUERY, navButtonSx, navChildButtonSx, navChildIconSx,
  navIconSx, navSoonChipSx,
} from './navStyles';

export interface ProductNavItemProps {
  product: NavProduct;
  expanded: boolean;
  /** Chave do filho ativo, se a rota atual estiver neste produto. */
  activeChildKey?: string;
  /** Drawer que renderiza o item: ids de `aria-controls` ficam únicos entre desktop e mobile. */
  idPrefix: 'desktop' | 'mobile';
  onToggle: (productKey: string) => void;
  onNavigate: (path: string) => void;
}

/**
 * Linha do produto + filhos (drawer expandido e mobile). Produto `soon` é desabilitado com
 * chip "Em breve" e Tooltip com a tagline; `available` expande/recolhe sem navegar.
 */
export function ProductNavItem({ product, expanded, activeChildKey, idPrefix, onToggle, onNavigate }: ProductNavItemProps) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const motionMs = reducedMotion ? 0 : NAV_MOTION_MS;
  const hasActiveChild = activeChildKey != null;

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
            sx={{ ...navButtonSx(false), cursor: 'default', color: 'text.disabled', '&:hover': { bgcolor: 'transparent' } }}
          >
            <ListItemIcon sx={{ ...navIconSx(false), color: 'inherit' }}>
              <AppIcon icon={product.icon} size="md" />
            </ListItemIcon>
            <ListItemText
              primary={product.label}
              primaryTypographyProps={{ variant: 'body2', fontWeight: 500, noWrap: true }}
            />
            <Chip label={s.soon} size="small" variant="outlined" sx={navSoonChipSx} />
          </ListItemButton>
        </Tooltip>
      </ListItem>
    );
  }

  const controlsId = `nav-${idPrefix}-product-${product.key}`;

  return (
    <ListItem disablePadding sx={{ mb: NAV_ITEM_GAP, display: 'block' }}>
      <ListItemButton
        onClick={() => onToggle(product.key)}
        aria-expanded={expanded}
        aria-controls={expanded ? controlsId : undefined}
        aria-label={product.label}
        sx={{
          ...navButtonSx(false),
          ...(hasActiveChild && !expanded ? { color: 'primary.main' } : {}),
        }}
      >
        <ListItemIcon sx={{ ...navIconSx(false), color: hasActiveChild ? 'primary.main' : undefined }}>
          <AppIcon icon={product.icon} size="md" />
        </ListItemIcon>
        <ListItemText
          primary={product.label}
          primaryTypographyProps={{ variant: 'body2', fontWeight: hasActiveChild ? 600 : 500, noWrap: true }}
        />
        <Box
          component="span"
          aria-hidden
          sx={{
            display: 'inline-flex',
            color: 'text.secondary',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: (t) => t.transitions.create('transform', { duration: NAV_MOTION_MS }),
            [`@media ${REDUCED_MOTION_QUERY}`]: { transition: 'none' },
          }}
        >
          <AppIcon icon={ChevronDown} size="sm" />
        </Box>
      </ListItemButton>

      <Collapse in={expanded} timeout={motionMs} unmountOnExit>
        <List
          id={controlsId}
          disablePadding
          sx={{
            // Linha-guia fina alinhada ao centro do ícone do produto.
            ml: 2.75,
            pl: 1,
            mt: NAV_ITEM_GAP,
            borderLeft: '1px solid',
            borderColor: 'divider',
          }}
        >
          {product.children.map((child) => {
            const active = child.key === activeChildKey;
            return (
              <ListItem key={child.key} disablePadding sx={{ mb: NAV_ITEM_GAP }}>
                <ListItemButton
                  selected={active}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(child.path)}
                  sx={navChildButtonSx}
                >
                  <ListItemIcon sx={navChildIconSx}>
                    <AppIcon icon={child.icon} size="md" />
                  </ListItemIcon>
                  {/* Com selo, o nome pode quebrar em 2 linhas em vez de ser cortado (ex.: "Caçador de Ofertas" + MAX). */}
                  <ListItemText
                    primary={child.label}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: active ? 600 : 500, noWrap: !child.badge, sx: child.badge ? { lineHeight: 1.25 } : undefined }}
                  />
                  {child.badge && <NavItemBadge badge={child.badge} />}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Collapse>
    </ListItem>
  );
}
