# Link de afiliado sempre do tenant — Decisões do dono

Registro das decisões de área cinzenta. Travam o design e as tasks.

| # | Decisão | Data | Origem |
| --- | --- | --- | --- |
| D1 | Loja sem credencial utilizável → **bloqueia** (`AFFILIATE_CREDENTIAL_REQUIRED`), nunca passa o link colado | 2026-11-11 | dono: "Faça" sobre as recomendações |
| D2 | Link já do tenant → mantém **só** o link curto oficial verificado (`meli.la`, `onelink`); o resto é recriado; Amazon sempre reescrita | 2026-11-11 | idem |
| D3 | Link de marketplace **acrescentado** na edição do texto → bloqueia ao salvar (`OFFER_TEXT_FOREIGN_LINK`); links que já estavam no texto ficam | 2026-11-11 | idem |
| D4 | Etiquetas do ML por plano: LITE 1, PRO 2, MAX 10. Etiqueta da conta não vinculada → bloqueia e oferece PRO e MAX. Destaque no banner de planos | 2026-11-11 | dono, mensagem direta |
| D5 | Ordem de execução: FH → FE → F1–F4; até 7 subagentes, RAM do Mac monitorada | 2026-11-11 | dono |
| D6 | Teste real (TE0) com a conta ML do dono, via cópia do perfil padrão do Chrome; o dono criou etiquetas extras para o teste | 2026-11-11 | dono |

Consequências aceitas: ver "Consequência da recomendação" das decisões na `spec.md` e "Riscos aceitos" no `design.md`.
