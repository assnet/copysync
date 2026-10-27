# Padrão de componentes do painel

Decisões de interface que valem para o painel inteiro. Componente novo que resolva um destes
casos **não é criado**: usa-se o daqui. Componentes em `app/src/components/` (export em
`index.ts`). Ícones têm doc própria: [`padrao-icones.md`](padrao-icones.md).

| Caso | Use | Não use |
|---|---|---|
| Ligar/desligar | `<Switch>` do MUI — o tema já aplica o estilo iOS (`theme.ts`, `MuiSwitch`) | `Checkbox` para liga/desliga; estilo de switch por tela |
| Faixa "entre X e Y" (intervalo, janela, preço) | `RangeSlider` | dois `TextField` numéricos |
| Espera/cooldown com fim conhecido | `CooldownBar` + `serverNow()` | `LinearProgress` com `setInterval` |
| Ícone | `AppIcon` (Lucide) | emoji, `@mui/icons-material` em tela nova |
| Confirmação destrutiva | `ConfirmDialog` | `window.confirm` |

## Switch (padrão iOS)

- Trilho 44×26, verde (`#22c55e`) ligado, cinza desligado; bolinha branca 22 px com sombra;
  sem ripple; anel de foco no teclado. Claro e escuro cobertos pelo tema.
- Decisão (2026-10-27): o estado ligado precisa ser lido de longe no celular; o switch MUI
  padrão (bolinha colorida sobre trilho translúcido) é ambíguo. Verde = ligado é convenção
  conhecida (iOS/Android).
- Sempre com rótulo: `FormControlLabel` ou `aria-label`. Texto auxiliar abaixo, em `caption`.

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
