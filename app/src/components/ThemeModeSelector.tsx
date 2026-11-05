import { useId, useState, type MouseEvent } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { useColorMode, type ThemePreference } from '@/contexts/ThemeContext';
import { themeModeStrings } from './themeModeStrings';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; icon: LucideIcon }> = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
];

/** Botão único do tema: abre menu com Sistema, Claro e Escuro. Ícone mostra a preferência. */
export function ThemeModeSelector() {
  const { preference, setPreference } = useColorMode();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const current = OPTIONS.find((o) => o.value === preference) ?? OPTIONS[0];
  const label = themeModeStrings.tooltip(themeModeStrings.options[current.value]);

  const choose = (value: ThemePreference) => {
    setPreference(value);
    setAnchor(null);
  };

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          aria-haspopup="menu"
          aria-controls={anchor ? menuId : undefined}
          aria-expanded={anchor ? 'true' : undefined}
          onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
        >
          <AppIcon icon={current.icon} size="md" />
        </IconButton>
      </Tooltip>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        MenuListProps={{ 'aria-label': themeModeStrings.menuLabel, dense: true }}
      >
        {OPTIONS.map(({ value, icon }) => {
          const selected = value === preference;
          return (
            <MenuItem key={value} selected={selected} onClick={() => choose(value)} role="menuitemradio" aria-checked={selected}>
              <ListItemIcon><AppIcon icon={icon} size="sm" /></ListItemIcon>
              <ListItemText
                primary={themeModeStrings.options[value]}
                secondary={value === 'system' ? themeModeStrings.systemHint : undefined}
              />
              {selected && <AppIcon icon={Check} size="sm" style={{ marginLeft: 12 }} />}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
