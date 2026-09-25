import { Component, lazy, Suspense, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { Box, CircularProgress, useTheme } from '@mui/material';
import { chatStrings } from '@/features/chat/strings';

/**
 * Seletor completo de emojis, reutilizável (reações, composer).
 *
 * - A lib só é baixada quando o picker abre: nada dela é importado estaticamente aqui,
 *   nem os enums — um `import { EmojiStyle }` no topo puxaria a lib para o bundle inicial.
 * - `emojiStyle` nativo é obrigatório: o padrão da lib busca cada emoji como imagem num CDN
 *   público (context.md D1). Nativo não faz requisição externa e o emoji é o mesmo dos chips.
 * - Falha ao baixar o chunk não quebra a tela: o picker some e `onClose` é chamado.
 * - A lib injeta seu CSS num `<style>` renderizado dentro do próprio picker (no `<body>`), e
 *   não no `<head>` — o DomGuardian só vigia o `<head>`, então não remove esse estilo.
 */
export type EmojiPickerProps = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

type LoadedPickerProps = EmojiPickerProps & { dark: boolean; style: CSSProperties };

const PICKER_WIDTH = 320;
const PICKER_HEIGHT = 400;

const texts = chatStrings.emojiPicker;

function loadPicker() {
  return lazy(async () => {
    const [lib, ptData] = await Promise.all([
      import('emoji-picker-react'),
      import('emoji-picker-react/dist/data/emojis-pt'),
    ]);
    const { default: Picker, EmojiStyle, Theme, Categories } = lib;

    const categories = [
      { category: Categories.SUGGESTED, name: texts.categories.suggested },
      { category: Categories.SMILEYS_PEOPLE, name: texts.categories.smileysPeople },
      { category: Categories.ANIMALS_NATURE, name: texts.categories.animalsNature },
      { category: Categories.FOOD_DRINK, name: texts.categories.foodDrink },
      { category: Categories.TRAVEL_PLACES, name: texts.categories.travelPlaces },
      { category: Categories.ACTIVITIES, name: texts.categories.activities },
      { category: Categories.OBJECTS, name: texts.categories.objects },
      { category: Categories.SYMBOLS, name: texts.categories.symbols },
      { category: Categories.FLAGS, name: texts.categories.flags },
    ];

    function LoadedPicker({ onSelect, dark, style }: LoadedPickerProps) {
      return (
        <Picker
          emojiStyle={EmojiStyle.NATIVE}
          theme={dark ? Theme.DARK : Theme.LIGHT}
          emojiData={ptData.default}
          categories={categories}
          searchPlaceholder={texts.searchPlaceholder}
          searchClearButtonLabel={texts.searchClear}
          previewConfig={{ showPreview: false }}
          width={PICKER_WIDTH}
          height={PICKER_HEIGHT}
          style={style}
          lazyLoadEmojis
          onEmojiClick={(data) => onSelect(data.emoji)}
        />
      );
    }

    return { default: LoadedPicker as ComponentType<LoadedPickerProps> };
  });
}

// `lazy` guarda a promise rejeitada; recriar após falha permite nova tentativa na próxima abertura.
let LazyPicker = loadPicker();

type BoundaryProps = { onError: () => void; children: ReactNode };

class ChunkErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    LazyPicker = loadPicker();
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const theme = useTheme();
  const { palette } = theme;

  // Alinha o picker às cores do tema do painel em vez da paleta própria da lib.
  const style = {
    '--epr-bg-color': palette.background.paper,
    '--epr-category-label-bg-color': palette.background.paper,
    '--epr-picker-border-color': palette.divider,
    '--epr-highlight-color': palette.primary.main,
    '--epr-category-icon-active-color': palette.primary.main,
    '--epr-text-color': palette.text.primary,
    '--epr-hover-bg-color': palette.action.hover,
    '--epr-focus-bg-color': palette.action.focus,
  } as CSSProperties;

  return (
    <Box
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <ChunkErrorBoundary onError={onClose}>
        <Suspense
          fallback={
            <Box
              sx={{ width: PICKER_WIDTH, height: PICKER_HEIGHT, display: 'grid', placeItems: 'center' }}
              aria-hidden
            >
              <CircularProgress size={24} />
            </Box>
          }
        >
          <LazyPicker onSelect={onSelect} onClose={onClose} dark={palette.mode === 'dark'} style={style} />
        </Suspense>
      </ChunkErrorBoundary>
    </Box>
  );
}
