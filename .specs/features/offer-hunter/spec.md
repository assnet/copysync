# Caçador de Ofertas (Shein) — spec

Estado: **plano com decisões do dono fechadas e portão T0a aprovado (2026-11-12); aguardando ordem para implementar**. Nada implementado. Base: api 0.92.0 · app 0.114.0 · extensão 3.4.0.
Branch: `feature/offer-hunter` a partir de `feature/rebranding-app`.

## Objetivo

Recurso do produto Afiliados que procura sozinho, no catálogo de comissão do painel de afiliados da Shein, os
produtos com melhor retorno esperado, refina (com ou sem IA) e envia só os melhores para **um** grupo.
Vira um monitoramento: cada "caçada" salva roda de tempos em tempos com os filtros escolhidos.

## Regras fixas (pedido do dono)

| # | Regra |
|---|---|
| R1 | Exclusivo Shein. Exclusivo do plano MAX (mesma régua do `marketplace_shein_enabled`). |
| R2 | Na primeira fase só o super admin vê e usa (menu, rota e API). |
| R3 | Teto de **10 ofertas garimpadas por dia** por tenant (achado escolhido conta, venha de execução manual ou agendada). O super admin edita o número por plano em `/admin/plan-entitlements`. |
| R4 | Envio para **1 grupo** por tenant. |
| R5 | Análise de IA é opcional por caçada. Sem IA o ranking é determinístico. |
| R6 | Só os melhores são enviados: `topN` por caçada (padrão 3, máximo 5). |

## Requisitos

- **HUNT-01** Criar, editar, pausar, retomar e excluir caçadas (máx. 5 por tenant).
- **HUNT-02** Filtros da fonte (o que a Shein filtra): ordenação, categoria, faixa de comissão, palavra-chave.
- **HUNT-03** Filtros locais (aplicados por nós na resposta): preço mín/máx, desconto mínimo, comissão mínima em % e
  em R$, nota mínima, faixa mínima de vendas e de avaliações, "só com comissão extra", "termina em até N dias".
- **HUNT-04** Predefinições de 1 clique: Maior comissão · Mais vendidos · Maior desconto · Novidades · Personalizada.
- **HUNT-05** Pontuação determinística 0–100 por produto, com os fatores visíveis na tela (por que entrou).
- **HUNT-06** IA opcional reordena os 15 melhores e devolve 1 frase de motivo por escolhido. Falha da IA não derruba
  a caçada: cai no ranking determinístico e a execução fica marcada `aiFallback`.
- **HUNT-07** Sem repetição: produto já enviado pela caçada não volta por 7 dias (configurável 1–30).
- **HUNT-08** Agenda: intervalo (mín. 30 min), dias da semana e janela de horário (mesmo modelo `weekdaysMask` +
  minutos do gerador).
- **HUNT-09** Entrega: `REVIEW` (achados ficam na tela para aprovar) ou `AUTO` (enfileira direto). Padrão `REVIEW`.
- **HUNT-10** "Testar agora": roda a caçada na hora e mostra o ranking. Só gasta o teto o que for escolhido
  (aprovado ou enviado), não a consulta. Guarda técnica à parte: no máximo 24 execuções por dia por tenant
  (constante, não é limite de plano) para conter chamadas à Shein.
- **HUNT-16** Teto diário: cada execução escolhe no máximo `min(topN, saldo do dia)`. Saldo zero → execução
  agendada é pulada **sem chamar a Shein** e a tela mostra "teto do dia atingido". Reserva atômica.
- **HUNT-17** `/admin/plan-entitlements` ganha edição de valor numérico para `offer_hunter_finds_per_day`
  (inteiro 0–100 por plano), com a mesma transação, propagação e auditoria das chaves booleanas.
- **HUNT-11** Link e dados finais de cada escolhido saem **só** de `ResolveAffiliateProductUseCase` (link sempre do
  tenant). O envio usa `EnqueueOfferUseCase` e o worker de ofertas existente.
- **HUNT-12** Ordem dos portões em toda execução: plano Shein → entitlement do caçador → credencial → aceite
  vigente do aviso do caçador (um só, que cobre busca, link e envio automáticos) → saldo do teto diário > 0 → chamada → reserva atômica dos escolhidos.
- **HUNT-13** Fonte indisponível 3 execuções seguidas ou sessão recusada: caçada pausa sozinha com motivo e alerta
  no painel. Nunca insistir em desafio anti-bot.
- **HUNT-14** Histórico por caçada: execuções (vistos, aprovados nos filtros, escolhidos, enviados, IA usada, erro)
  e achados (produto, pontuação, motivo, estado).
- **HUNT-15** Painel: contador "X de 10 hoje" (valor vindo da API), white label, claro/escuro/sistema, textos em `strings.ts`,
  `usePersistedState` no assistente, flags de privacidade, ícones via `AppIcon` (sem brilhinho para IA).

## Fora do escopo

Outros marketplaces · mais de 1 grupo · IA escrevendo o texto da oferta (já é do gerador) · leitura de página de
produto · qualquer header anti-bot · execução pelo navegador do usuário ou pela extensão (D6).

## Decisões do dono (2026-11-12)

| # | Decisão |
|---|---|
| D1 | Seguir apesar dos termos Shein (3.3.2 e Anexo 3 §6), com aviso de risco próprio do caçador. |
| D2 | Aceite separado (`scope = OFFER_HUNTER`); o aviso Shein atual não muda de versão. |
| D3 | O grupo do caçador entra na união gerador ∪ monitoramento ∪ caçador de `broadcast_groups`; grupo já usado não consome de novo. |
| D4 | Oferta do caçador **não** consome `offer_generations_per_day`: é separado do gerador. |
| D5 | O teto é de **ofertas garimpadas**, 10 por dia, editável pelo super admin por plano. Não é teto de execuções. |
| D6 | Só por HTTPS a partir do servidor: tem de funcionar com o navegador fechado. Sem caminho pela extensão. T0 reprovou → o recurso não é construído e volta para o dono. |

## Critérios de aceite

1. Usuário comum de tenant MAX não vê o menu e recebe 403 nas rotas (fase de prévia).
2. Com o aviso do caçador aceito por um `ADMIN` do tenant de teste, o super admin cria caçada "Maior comissão",
   testa e vê ranking com pontuação e fatores.
3. Com IA ligada, o ranking traz motivo por item; com provedor de IA fora do ar a execução conclui com `aiFallback`.
4. Com 10 ofertas garimpadas no dia, nova execução responde 429 `OFFER_HUNT_DAILY_LIMIT` sem chamar a Shein; com
   saldo 2 e `topN` 5, saem 2. Super admin muda o teto do MAX para 15 na tela e o saldo acompanha sem deploy.
5. Modo `AUTO`: até `topN` ofertas chegam ao grupo com link `onelink` do tenant, respeitando intervalo do gerador.
6. Mesma caçada em sequência não reenvia produto dentro da janela de repetição.
7. Token `AT` não aparece em log, resposta, evento nem prompt de IA (teste).
