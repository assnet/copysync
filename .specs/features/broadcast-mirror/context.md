# Disparo em massa (espelhamento) — Context

**Gathered:** 2026-10-26 (durante a spec do gerador) · **Spec:** a criar · **Status:** Aguardando spec

Item 10 do roadmap (`campaigns/broadcast-mirror`). Independente do gerador de ofertas.

## Feature Boundary

Tela "Disparo em massa" (em "Ações especiais"): o operador escolhe a instância WhatsApp, um grupo de
origem (onde só ele posta) e os grupos de destino, e confirma. Tudo o que ele postar no grupo de
origem é espelhado nos destinos.

## Decisões do owner

- Destinos podem estar em **qualquer sessão** do tenant (não só a da origem).
- Espelha **texto, imagem + legenda e vídeo**.
- Envio aos destinos com **intervalo configurável** (fila por sessão, não rajada).
- Troca de link no espelho **não** foi pedida (fica com Monitoramento, item 4).

## Pontos para a spec
- Reconhecer "postado pelo operador" (`fromMe` na origem) e ignorar o eco dos próprios espelhos.
- Reaproveitar o worker durável de envio do gerador (`OfferDispatch` → contrato genérico de envio espaçado).
- Mídia recebida: baixar uma vez para o store e reenviar a todos os destinos.
