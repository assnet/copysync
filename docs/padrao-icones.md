# Padrão de ícones do painel

Decisão (2026-10-27): **Lucide** (`lucide-react`) é a biblioteca de ícones do painel, sempre via
o componente **`AppIcon`** (`app/src/components/AppIcon.tsx`).

## Por quê

- Traço único e consistente (linha, 24×24), legível em claro e escuro sem variantes.
- Ícone por import nomeado: o bundle leva só o que é usado.
- Emoji não serve como ícone de interface: muda de desenho por sistema, não herda cor do tema
  e não tem tamanho previsível.

## Como usar

```tsx
import { Dumbbell } from 'lucide-react';
import { AppIcon } from '@/components';

// Ao lado de texto (padrão): mesma linha, alinhado pelo flex do pai
<Typography sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
  <AppIcon icon={Dumbbell} />
  Fitness
</Typography>

// Isolado (botão de ícone) com nome acessível
<IconButton aria-label="Aumentar"><AppIcon icon={Plus} size="md" /></IconButton>
```

## Tamanhos (`APP_ICON_SIZES`)

| Token    | Valor    | Quando                                                                 |
|----------|----------|------------------------------------------------------------------------|
| `inline` | `1.25em` | **Padrão.** Ao lado de texto: acompanha a fonte, então escala sozinho entre desktop e mobile. |
| `sm`     | 16 px    | Ícone isolado em área densa (chips, ações de linha).                   |
| `md`     | 20 px    | Ícone isolado padrão (botões de ícone).                                |
| `lg`     | 24 px    | Destaque (estado vazio, cabeçalho).                                    |

Não passar `size` numérico solto nem `width/height` no SVG: use um token. Se faltar um, adicione
em `APP_ICON_SIZES` e nesta tabela.

## Regras

- Cor: herda `currentColor`. Para destacar, mude a cor do **texto pai** (ex.: `primary.main` no
  item selecionado), nunca do ícone sozinho.
- Ícone com texto ao lado é decorativo (`aria-hidden`, padrão do `AppIcon`). Ícone sozinho
  precisa de `label` no `AppIcon` ou `aria-label` no botão, e de Tooltip (AGENTS.md).
- Espaço entre ícone e texto: `gap: 0.75` (6 px) no flex do pai.
- Mapas de ícone por domínio ficam na config da feature (ex.: `AUDIENCE_ICONS` em
  `features/offers/utils/offerConfig.ts`), não em `strings.ts` — strings é só texto (i18n).

## Migração

`@mui/icons-material` ainda aparece em telas antigas. Regra: **ícone novo é sempre Lucide**, e
tela tocada migra os ícones que mexer. Não misturar as duas bibliotecas no mesmo componente.

Telas já no padrão: menu lateral (`AppLayout`, inclusive tema/colapso/sair), público-alvo do
gerador de ofertas (`AudiencePicker`, seletor "Público do novo texto"), páginas de módulo em
desenvolvimento (`pages/modules`). Ícone de módulo do menu e da página vêm do mesmo mapa
(`MODULE_ICONS`).
