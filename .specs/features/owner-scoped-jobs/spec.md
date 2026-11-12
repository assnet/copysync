# Jobs de sessão só no processo dono — Spec

**Tamanho:** Medium. **Status:** em execução (aprovado pelo dono em 2026-11-11).
**Origem:** incidente de 2026-11-12. O 1º `copysync_worker` (Private Service, `PROCESS_ROLE=worker`) subiu ao lado da api
`all`, pegou envios de oferta de sessões que pertencem à api e falhou com `SESSION_NOT_CONNECTED` (7 envios atrasados,
recuperados; worker suspenso). O mesmo aconteceria com 2+ workers: o claim é global e a engine é local.

## Alternativas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| **A. Cada processo só pega trabalho de sessões que ele segura (lease vivo próprio)** | ✅ | Envio direto, sem salto; trabalho proporcional às sessões de cada worker; nada muda com 1 processo |
| B. Qualquer processo pega e envia pelo dono (RPC/fila no Redis) | ❌ | Salto extra por envio (Redis + S3 na mídia), timeout de 10 s, carga no Redis cresce com o volume |
| C. Desligar os jobs no worker durante a transição | ❌ | Só adia: com 2+ workers o problema volta |

## Requisitos

| ID | Requisito |
| --- | --- |
| OWN-01 | `claimDue` (envio de ofertas) **exclui** envio cuja sessão (`d.sessionId`) tem lease vivo de **outro** processo (`ownerWorkerId <> eu AND leaseUntil > now() AT TIME ZONE 'UTC'`). Sessão minha ou sem dono vivo: comportamento atual (sem dono: falha offline, `waitForSession`, desiste em 6 h). `sessionId` nulo (envio antigo) não é excluído. O `workerId` entra no construtor do repositório (`currentWorkerId()`), valendo nos dois caminhos do claim (sequencial e concorrente) |
| OWN-02 | Mesmo relógio e definição de "vivo" do lease. A exclusão é um anti-join com o conjunto (pequeno) de sessões com lease vivo de outro processo, não um lookup por linha; medir o plano (`EXPLAIN`) no descartável |
| OWN-03 | Sync de membros do Gestor de Links: `listDue` só lista grupos de sessões com lease vivo deste processo (relógio do banco). O lease do job passa a ser por processo (`link-rotation-member-sync:<workerId>`) e o tick apaga leases desse job vencidos há mais de 1 dia (ids de processo mudam a cada boot). O teto de 50 chamadas/min passa a ser por processo (carga por sessão igual); atualizar comentário e `docs/rodizio-de-links.md` |
| OWN-04 | Tenant suspenso: o listener só grava status e desconecta **sessões deste processo ou sem dono vivo**; nunca toca sessão com lease vivo de outro processo (não há caminho remoto a partir de `worker`/`all`: o dono `all` não consome fila). Cada processo que roda sessões ganha uma varredura (tick 30 s) que desconecta as **próprias** sessões cujo tenant não está `ACTIVE`, cobrindo a suspensão detectada em outro processo |
| OWN-05 | Com um único processo `all` (produção hoje), mesmo resultado de hoje. Exceção aceita: logo após um restart, sessão com lease ainda vivo do processo anterior fica fora do claim até o lease vencer (≤ 60 s); o envio só atrasa |
| OWN-06 | Teste de integração com **dois workerIds** disputando a fila de envios no Postgres descartável: cada um só pega envios das próprias sessões; sessão sem dono continua sendo pega |
| OWN-08 | O keeper de lease inicia **antes** do bootstrap das sessões, para um bootstrap longo não deixar lease vencer e derrubar sessões recém-abertas (reconexão em massa no deploy) |
| OWN-07 | Docs: `docs/arquitetura-escala.md` §3.3 (dono por job) e §5.1 (checklist: "jobs de sessão por dono" antes do 2º processo); `docs/fila-de-envio.md` se citar o claim |

## Fora do escopo

- `pendingMediaSweep` periódico (sem engine; só marca FAILED mídia órfã antiga) — registrar no doc.
- Etapa de capturas do monitoramento (sem engine; o envio sai pelo claim de OWN-01).

## Critério de aceite

Com a api `all` e um worker vazio ao mesmo tempo, o worker não pega nenhum envio de sessão da api; com dois workers, cada
envio sai pelo dono da sessão; com um processo só, nada muda.
