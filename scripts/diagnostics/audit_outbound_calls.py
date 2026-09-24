#!/usr/bin/env python3
"""
Audita as chamadas de saída que uma feature adiciona.

Serve à restrição de segurança da sincronização de estado de conversa: nenhuma chamada
nova ao WhatsApp, nem gatilho novo para as que já existem. Volume de saída fora do padrão
humano é o principal sinal de automação, e o número do usuário é quem paga.

Por que um script, e não um comando no roteiro: o comando precisa de guardas. Sem elas,
ele falha devolvendo vazio — e vazio é indistinguível de "nada foi adicionado". Três modos
de falha silenciosa já apareceram na prática:

  1. intervalo vazio (a feature já entrou em develop, merge-base vira o próprio HEAD)
  2. commit de merge, que `git show -- <paths>` não expande sem -m
  3. filtro que não casa com commit nenhum (escopo mudou, trailer esquecido)

Aqui cada um desses casos é erro explícito, com código de saída diferente de zero.

Limitação conhecida: commit da feature que tenha **escopo alheio e nenhum trailer** fica
invisível — não entra na seleção (o escopo não casa) nem gera aviso (o aviso só cobre quem
entrou pelo escopo). Um `chore(build): ...` sem trailer que adicionasse chamada de saída
passaria batido. O script não tem como adivinhar a que feature ele pertence; quem fecha essa
porta é o trailer ser obrigatório — um hook `commit-msg` ou uma checagem no CI, ainda não
implementados aqui.

Uso:
    python3 scripts/diagnostics/audit_outbound_calls.py
    python3 scripts/diagnostics/audit_outbound_calls.py --base origin/develop \\
        --feature chat-remote-state-sync
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys

# Chamadas que atravessam a fronteira do processo em direção ao WhatsApp, ou que disparam
# quem o faz. `socket.` é o adapter Baileys; `engine.` é a porta da mensageria; no painel,
# `chatService.` é o único caminho até a API.
PADRAO_SAIDA = re.compile(r"(socket|engine|chatService)\.[a-zA-Z]+\(")

# Gatilhos que a feature declarou e justificou. Ver a exceção da T15 na spec: marcar leitura
# quando a mensagem chega na conversa que o operador já tem aberta, agrupada em uma chamada
# por 1,5 s.
DECLARADAS = {"chatService.markAsRead("}

CAMINHOS_CODIGO = ["api/src", "app/src"]

# Dublês de teste citam a engine sem chamá-la de verdade. Incluí-los transformaria
# `engine.markMessagesRead(...)` num mock em "chamada de saída nova".
EXCLUSOES = [":(exclude)**/*.test.ts", ":(exclude)**/*.test.tsx"]

PATHSPEC = [*CAMINHOS_CODIGO, *EXCLUSOES]


def git(*args: str) -> str:
    resultado = subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    )
    if resultado.returncode != 0:
        sys.exit(f"erro: git {' '.join(args)}\n{resultado.stderr.strip()}")
    return resultado.stdout


def commits_da_feature(base: str, feature: str, escopo: str) -> list[tuple[str, str]]:
    """
    Commits a auditar, sem merges.

    Prefere o trailer `Feature:`, que identifica a feature mesmo quando várias compartilham
    o escopo do commit. Cai para o escopo quando nenhum commit tem o trailer — é o caso dos
    commits anteriores à adoção dele.
    """
    intervalo = f"{base}..HEAD"
    saida = git(
        "log", "--no-merges", "--format=%h%x09%s%x09%(trailers:key=Feature,valueonly)",
        intervalo,
    )
    linhas = [l for l in saida.splitlines() if l.strip()]
    if not linhas:
        sys.exit(
            f"erro: intervalo {intervalo} não tem commit nenhum.\n"
            "A base provavelmente já contém a feature (merge-base virou o próprio HEAD).\n"
            "Rode com --base apontando para antes do primeiro commit da feature."
        )

    # O log vem do mais recente para o mais antigo: índice menor = commit mais novo.
    com_trailer, no_escopo = [], []
    indice_por_sha: dict[str, int] = {}
    indice_trailer_mais_antigo: int | None = None
    for i, linha in enumerate(linhas):
        partes = linha.split("\t")
        sha, assunto = partes[0], partes[1]
        trailer = partes[2].strip() if len(partes) > 2 else ""
        indice_por_sha[sha] = i
        if trailer == feature:
            com_trailer.append((sha, assunto))
            indice_trailer_mais_antigo = i
        if f"({escopo}):" in assunto:
            no_escopo.append((sha, assunto))

    # União, nunca substituição: commit da feature pode ter o trailer e um escopo
    # diferente (um utilitário em `chore(diagnostics)`, por exemplo). Filtrar só por um
    # dos critérios deixaria esse commit fora da auditoria sem avisar ninguém.
    vistos: set[str] = set()
    selecionados = []
    for sha, assunto in com_trailer + no_escopo:
        if sha in vistos:
            continue
        vistos.add(sha)
        selecionados.append((sha, assunto))

    if com_trailer:
        # Avisar sobre os commits anteriores à adoção do trailer seria ruído permanente:
        # eles já estão publicados e o projeto decidiu não reescrever histórico. O aviso
        # serve para pegar commit **novo** que esqueceu o trailer.
        shas_com_trailer = {sha for sha, _ in com_trailer}
        esquecidos = [
            (sha, assunto)
            for sha, assunto in selecionados
            if sha not in shas_com_trailer
            and indice_trailer_mais_antigo is not None
            and indice_por_sha[sha] < indice_trailer_mais_antigo
        ]
        if esquecidos:
            print(
                f"aviso: {len(esquecidos)} commit(s) depois da adoção do trailer sem "
                f"'Feature: {feature}':",
                file=sys.stderr,
            )
            for sha, assunto in esquecidos:
                print(f"  {sha} {assunto}", file=sys.stderr)
        return selecionados

    if not no_escopo:
        sys.exit(
            f"erro: nenhum commit casa com o trailer 'Feature: {feature}' nem com o "
            f"escopo ({escopo}) em {intervalo}.\n"
            "Filtro errado ou base errada — nunca interprete isso como 'nada adicionado'."
        )
    return selecionados


def tocou_codigo(sha: str) -> bool:
    """true quando o commit mexeu em algum arquivo dentro de CAMINHOS."""
    return bool(git("show", "--name-only", "--format=", sha, "--", *PATHSPEC).strip())


def chamadas_adicionadas(sha: str) -> list[str]:
    diff = git("show", sha, "--", *PATHSPEC)
    achados = []
    for linha in diff.splitlines():
        if not linha.startswith("+") or linha.startswith("+++"):
            continue
        achados.extend(m.group(0) for m in PADRAO_SAIDA.finditer(linha))
    return achados


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="origin/develop",
                        help="ref com que calcular o merge-base (padrão: origin/develop)")
    parser.add_argument("--feature", default="chat-remote-state-sync",
                        help="valor do trailer Feature: a filtrar")
    parser.add_argument("--escopo", default="chat",
                        help="escopo do commit, usado quando não há trailer")
    args = parser.parse_args()

    base = git("merge-base", args.base, "HEAD").strip()
    print(f"base: {base[:9]} {git('log', '-1', '--format=%s', base).strip()}")

    commits = commits_da_feature(base, args.feature, args.escopo)
    print(f"commits auditados: {len(commits)} (merges excluídos)\n")

    total: dict[str, int] = {}
    commits_com_codigo = 0
    for sha, _assunto in commits:
        if not tocou_codigo(sha):
            continue
        commits_com_codigo += 1
        for chamada in chamadas_adicionadas(sha):
            total[chamada] = total.get(chamada, 0) + 1

    # Quarta falha silenciosa: commits auditados, mas nenhum tocou os caminhos de código.
    # Significa CAMINHOS desatualizado (pasta renomeada) ou filtro pegando só documentação
    # — nos dois casos, nada foi realmente examinado.
    if commits_com_codigo == 0:
        sys.exit(
            f"erro: nenhum dos {len(commits)} commits tocou {', '.join(CAMINHOS_CODIGO)}.\n"
            "CAMINHOS desatualizado ou filtro pegando só documentação — isso não é "
            "'feature limpa'."
        )
    print(f"commits que tocaram código: {commits_com_codigo}")

    if not total:
        print("nenhuma chamada de saída adicionada.")
        return 0

    nao_declaradas = {c: n for c, n in total.items() if c not in DECLARADAS}
    for chamada, n in sorted(total.items()):
        marca = "declarada" if chamada in DECLARADAS else "NÃO DECLARADA"
        print(f"  {n:>3}  {chamada:<40} {marca}")

    if nao_declaradas:
        print(
            "\nfalha: chamada de saída não declarada na spec. "
            "Confirme que é intencional e acrescente a DECLARADAS, com o porquê.",
            file=sys.stderr,
        )
        return 1

    print("\nok: só as chamadas declaradas na spec.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
