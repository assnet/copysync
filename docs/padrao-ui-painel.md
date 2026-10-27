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

## Persistência contra reload

Recarregar a página não pode jogar fora o que o usuário estava fazendo. Toda tela nova nasce com
`usePersistedState(key, inicial, opts)` (`app/src/hooks/usePersistedState.ts`) para o estado de
trabalho:

| Persistir (estado de interface) | Não persistir |
|---|---|
| rascunho de formulário (campos digitados) | dado vindo da API (recarregue pelo id) |
| passo e escolhas de assistente (seleções, intervalos) | segredos, tokens, senhas |
| filtros, busca, ordenação, "ver todos" | estado derivado (contadores, validação) |
| id do item aberto (oferta, conversa) | estado transitório (`loading`, `saving`) |

- Escopo `tab` (sessionStorage) por padrão: sobrevive a reload, some ao fechar a aba. `browser`
  (localStorage) só para preferência duradoura (tema, menu recolhido, privacidade).
- Chave `tela.item` (o hook prefixa `ui.`); `version` quando a forma do estado mudar.
- `clear()` ao concluir o fluxo (salvar, cancelar, "nova oferta"): rascunho velho não volta.
- Map/Set: passe `serialize`/`deserialize` ou guarde como array de pares.
- Primeira tela coberta: Gerador de ofertas (formulário, oferta aberta, assistente inteiro,
  filtros do passo de grupos, assistente aberto/fechado).

## Privacidade (borrar dados na tela)

Menu "Privacidade" abre um diálogo (`features/privacy/PrivacyDialog`) com flags por tela e por
tipo de dado; preferência por navegador (`localStorage`, `privacy.blur`). Uso: gravar ou
compartilhar a tela sem expor clientes, grupos e produtos.

**Regra para toda tela nova (desde o planejamento):**

1. Liste os dados sensíveis que a tela mostra (nomes, fotos, números, textos de terceiros).
2. Registre a tela e uma flag por tipo de dado em `privacyFlags.ts` (`<tela>.<dado>`): o diálogo
   monta as opções sozinho a partir do registro.
3. Nos pontos de exibição, envolva com `<Blurred when={useBlur('tela.dado')}>` (texto: `inline`,
   raio 5–6; imagem: raio 10–14 via `sx`/`filter`) ou aplique `filter: blur()` no elemento.
4. Teste com a flag ligada: o layout não pode mudar (o desfoque mantém o espaço).

Limites: proteção **visual**; o dado continua no DOM e na API. Não substitui permissão.
Telas cobertas: Painel/menu (e-mail e papel do usuário) e Gerador de ofertas (sessão, fotos e nomes de grupos, público-alvo, imagens e texto das ofertas).

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
