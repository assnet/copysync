# Navegação por produtos (menu do painel)

Desde app 0.61.0 o menu lateral deixa de ser lista plana e passa a agrupar telas por **produto**.
Cada produto é um acordeão com seus itens; produto "em breve" aparece desabilitado, sem filhos,
para o cliente já ver o que vem. Catálogo e status dos produtos: seção "Produtos (menu)" de
[`produto-roadmap.md`](produto-roadmap.md). Nomes em código seguem o recurso (white label), nunca a marca.

## Estrutura

Fora dos produtos: **Dashboard** (`/dashboard`) no topo; seção **Plataforma** só super admin
(`/admin/ai`, `/admin/link-domains`); bloco inferior **Planos** (`/plans`), **Privacidade**
(ação: abre o diálogo, não é rota), **Configurações** (`/settings/*`, `matchPrefix`).

| Produto | `status` | Filhos | Rota | Selo |
|---|---|---|---|---|
| Afiliados | `available` | Gerador de ofertas | `/offers` | |
| | | Monitoramento | `/monitoring` | |
| | | Rodízio de links | `/link-rotation` | |
| | | Página de Ofertas | `/storefront` | PRO |
| | | Story de Oferta | `/offer-story` | MAX |
| CRM & Automação | `soon` | Chat (só super admin) | `/chat` | |
| Gestor de Grupos | `soon` | — | — | |
| Saver | `soon` | — | — | |
| Aquecedor de Chip | `soon` | — | — | |

Produto `soon` sem filho visível fica desabilitado (sem acordeão, `aria-disabled`, selo "Em breve").
Produto `soon` com filho visível para o usuário atual (CRM para super admin) abre normalmente.

## Onde fica cada coisa

| Peça | Arquivo | Nota |
|---|---|---|
| Textos (rótulos, selos, aria) | `app/src/features/navigation/strings.ts` | padrão i18n do painel; nenhum rótulo fora daqui |
| Modelo | `app/src/features/navigation/model.ts` | `buildNavigation({ isSuperAdmin })` → seções e `NavProduct[]`; `findActiveEntry(path)`; tipo `NavProduct` com `status: 'available' \| 'soon'` |
| Estado | `app/src/features/navigation/useNavigationState.ts` | produtos expandidos em `usePersistedState('navigation.expandedProducts', …, { scope: 'browser' })` |
| Acordeão (sidebar aberta) | `app/src/app/nav/ProductNavItem.tsx` | cabeçalho do produto + filhos |
| Sidebar recolhida | `app/src/app/nav/CollapsedProductNavItem.tsx` | ícone do produto; popover à direita com `MenuList` (setas, Home/End, Esc) |
| Item de 1º nível | `app/src/app/nav/NavLinkItem.tsx` | Dashboard, Plataforma e bloco inferior; selo inline; `aria-label` quando recolhido |
| Estilos compartilhados | `app/src/app/nav/navStyles.ts` | alturas, gap, chip "Em breve", anel de foco, `REDUCED_MOTION_QUERY` |
| Ícones dos módulos | `app/src/features/navigation/icons.ts` | `MODULE_ICONS` (reexportado por `pages/modules`); `model.ts` nunca importa de `pages/` |
| Layout | `app/src/app/AppLayout.tsx` | só consome o modelo; não declara item |

## Como adicionar

**Item em um produto existente** (ex.: tela nova do Afiliados):
1. Garantir que a funcionalidade está em `produto-roadmap.md` e a rota em `routes/AppRoutes.tsx`.
2. Rótulo (e selo de plano, se houver) em `navigation/strings.ts`.
3. Entrada no array `children` do produto em `model.ts` (`path`, `label`, `icon` Lucide via `AppIcon`,
   `badge?`, `superAdminOnly?`, `matchPrefix?`).
4. Se a rota tem gate de plano, o selo vem de `plansStrings.badge*`, não de texto novo.

**Produto novo**:
1. Registrar antes na seção "Produtos (menu)" de `produto-roadmap.md` (nome, status, funcionalidades).
2. Nome e descrição curta em `strings.ts`; ícone Lucide próprio.
3. `NavProduct` em `buildNavigation` com `id` estável (kebab-case do recurso, ex. `group-manager`),
   `status: 'soon'` até ter a primeira tela, `children: []`.
4. O `id` é a chave persistida de expandido/recolhido: trocar o `id` reseta a preferência do usuário.

## Comportamento

- **Desktop, sidebar aberta**: produto é acordeão (`ProductNavItem`). Clique no cabeçalho
  expande/recolhe; filho ativo mantém o produto aberto e destacado. Vários produtos podem ficar
  abertos; o estado é por produto.
- **Desktop, sidebar recolhida**: só ícones. Produto disponível abre popover à direita com os
  filhos (clique, Enter ou →); setas ↑↓ navegam, Esc fecha. Produto `soon` fica atenuado, mostra
  tooltip "Em breve · tagline" e não abre popover. Ponto no ícone = contém a tela atual.
- **Mobile (drawer temporário)**: mesmo acordeão da sidebar aberta; navegar fecha o drawer.
- Rota ativa resolve por `findActiveEntry(pathname)`: match exato, ou por prefixo quando
  `matchPrefix`. Ao carregar a página numa rota de filho, o produto pai abre mesmo que estivesse
  recolhido na preferência.

## Acessibilidade

- Cabeçalho do produto é `button` com rótulo estático, `aria-expanded` e `aria-controls` só quando
  expandido (filhos desmontados quando recolhido). Ids levam `idPrefix` (`desktop`/`mobile`): os dois
  drawers ficam montados ao mesmo tempo (`keepMounted`).
- `<nav aria-label>` com `tabIndex={-1}` na área rolável (Chrome não deve parar nela no Tab).
  Todo botão só-ícone (recolhido, hambúrguer, tema) tem `aria-label`.
- `document.title` = "Seção · nome do produto" a partir do link ativo.
- Item ativo leva `aria-current="page"`; produto recolhido com filho ativo ganha o texto
  "Contém a tela atual" no `aria-label`.
- Alvo de toque mínimo 44 px em cabeçalho e filhos; foco visível pelo anel do tema.
- Animação do acordeão e do popover respeita `prefers-reduced-motion` (`REDUCED_MOTION` do estilo
  da feature): sem transição quando reduzido.
- Selo de plano e "Em breve" são texto (não só cor), sempre inline à direita numa linha; rótulos
  `noWrap` com drawer de 272 px (nunca truncar nome de produto). Títulos de seção e chips em
  `text.secondary` (contraste ≥ 4.5:1 nos dois temas; `text.disabled` não passa).

## Persistência

`navigation.expandedProducts` (`usePersistedState`, escopo `browser`): preferência duradoura, como o
menu recolhido. Valor: ids dos produtos expandidos. Não é limpo ao navegar. Rota ativa nunca é
persistida: vem da URL. Ver seção "Persistência" de [`padrao-ui-painel.md`](padrao-ui-painel.md).

## Decisão: sessão é do tenant, não do produto

Registrada em 2026-11-03, sem implementação ainda:

- Cada produto terá **plano, permissões e configurações próprios**, definidos numa etapa futura.
- **Sessão (número de WhatsApp conectado) pertence ao tenant.** A mesma sessão pode servir mais
  de um produto (número usado no Afiliados também atende CRM & Automação) e o usuário pode
  dedicar uma sessão por produto, se preferir. Limites de sessão seguem por tenant/plano
  (`whatsapp_sessions`), nunca por produto.
- Consequência para o menu: Configurações → Sessões fica fora dos produtos, no bloco inferior.

## Próximos passos

- Visibilidade de produto por entitlement (`NavProduct.status` ganha origem no tenant, não em constante).
- Permissões por produto e por usuário do tenant; produto sem permissão some do menu.
- Configurações por produto (ex.: `/affiliates/settings`) como filho do próprio produto.

## O que não fazer

- Rota nova sem item em `model.ts`, nem item em `model.ts` sem rota em `AppRoutes.tsx`.
- Rótulo, selo ou aria hardcoded fora de `navigation/strings.ts`; `AppLayout.tsx` não declara item.
- Produto novo que não exista em `produto-roadmap.md` (seção "Produtos (menu)").
- Marca em nome de chave, id, função ou evento (`copysync*`); nomes descrevem o recurso.
- Esconder tela por plano no menu: o selo informa, a rota e o backend aplicam o gate.
- Persistir rota ativa ou dado do servidor em `navigation.*`; só preferência de interface.
- Acordeão/popover próprio em outra tela: o padrão de navegação vive só em `app/src/app/nav/`.
