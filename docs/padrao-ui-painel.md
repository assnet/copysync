# Padrão de componentes do painel

Decisões de interface que valem para o painel inteiro. Componente novo que resolva um destes
casos **não é criado**: usa-se o daqui. Componentes em `app/src/components/` (export em
`index.ts`). Ícones têm doc própria: [`padrao-icones.md`](padrao-icones.md).

| Caso | Use | Não use |
|---|---|---|
| Ligar/desligar simples (inline) | `<Switch>` + `FormControlLabel` — o tema já aplica o estilo iOS e o alinhamento | `Checkbox` para liga/desliga; estilo de switch por tela |
| Opção com título, texto auxiliar e/ou controles filhos | `ToggleOption` (linha inteira clicável, realce quando ligada, filhos revelados abaixo alinhados ao título) | `FormControlLabel` + `Typography` soltos; filhos com `ml` fixo |
| Faixa "entre X e Y" (intervalo, janela, preço) | `RangeSlider` | dois `TextField` numéricos |
| Espera/cooldown com fim conhecido | `CooldownBar` + `serverNow()` | `LinearProgress` com `setInterval` |
| Ícone | `AppIcon` (Lucide) | emoji, `@mui/icons-material` em tela nova |
| Confirmação destrutiva | `ConfirmDialog` | `window.confirm` |
| Grupo de WhatsApp em lista/chip | `GroupAvatar` / `GroupChip` (`features/offers/components/GroupChip.tsx`): foto, senão iniciais, senão ícone | `Chip` só com texto; ícone genérico quando há foto |

## Switch (padrão iOS)

- Trilho 36×20, azul primário (`#4f70e0`) ligado, cinza desligado; bolinha branca 16 px com
  sombra; sem ripple; anel de foco no teclado. Claro e escuro cobertos pelo tema.
- Decisão (2026-10-27): o estado ligado precisa ser lido de longe no celular; o switch MUI
  padrão (bolinha colorida sobre trilho translúcido) é ambíguo. Trilho cheio = ligado, na cor
  primária para seguir a identidade do painel (verde ficou reservado para status/sucesso).
- Sempre com rótulo: `FormControlLabel` ou `aria-label`. Texto auxiliar abaixo, em `caption`.

## ToggleOption

- Card de borda fina; a linha inteira é `<label>` do switch (alvo ≥ 44 px, clique em qualquer
  ponto alterna). Ligada: borda e fundo com 6–10% da cor primária, transição 200 ms.
- Título em `subtitle2` 600 e texto auxiliar em `caption` abaixo, ambos alinhados pela borda do
  conteúdo do card (o switch fica na margem, não "para fora" dela).
- Controles filhos (`children`) só aparecem ligados, com `Collapse` (0 ms sob
  `prefers-reduced-motion`), separados por linha fina e alinhados ao título — fora do `<label>`,
  para clique neles não alternar o toggle.
- Acessibilidade: `aria-labelledby`/`aria-describedby` no input do switch.

## RangeSlider

- Dois cursores arrastáveis; os valores escolhidos ficam nos extremos e acompanham o arraste;
  os limites da escala aparecem abaixo. Teclado: setas movem 1 passo; `aria-valuetext` com
  unidade.
- `minDistance` impede cruzar; `clampRange` (pura) é a regra, testada.
- `status` (opcional) vira termômetro: `score` 0–1 colore faixa, cursores e um rótulo centralizado
  (`label`, `role="status"`); quem chama calcula o score com uma regra pura da feature.
- `formatValue` com unidade (`8 min`, `R$ 10`). Largura: limitar o pai (`maxWidth`) em telas
  largas; no celular ocupa a linha.

## CooldownBar

Ver [`gerador-de-ofertas.md`](gerador-de-ofertas.md) ("Espera até o próximo envio") e
`CooldownBar.tsx`. Relógio sempre do servidor (`X-Server-Time`).
