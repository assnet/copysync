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


def base_pela_feature(feature: str) -> str | None:
    """
    Base derivada do histórico: pai do commit mais antigo que carrega o trailer.

    Serve para depois do merge em develop, quando `git merge-base origin/develop HEAD`
    degenera para o próprio HEAD e o intervalo fica vazio.

    Só o trailer serve aqui. O escopo do commit já foi tentado e recuava para o commit
    `(chat):` mais antigo do repositório — meses atrás, 64 commits, 22 chamadas de features
    alheias marcadas como não declaradas. Um relatório grande demais se parece com auditoria
    de verdade, e essa é a pior forma de errar: sem trailer, este script prefere recusar e
    pedir `--base`.
    """
    saida = git(
        "log", "--reverse", "--no-merges",
        "--format=%h%x09%(trailers:key=Feature,valueonly)",
    )
    for linha in saida.splitlines():
        partes = linha.split("\t")
        if len(partes) > 1 and partes[1].strip() == feature:
            return f"{partes[0]}^"
    return None


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

    # Depois do merge em develop, a ref de comparação passa a conter a feature e o
    # merge-base vira o próprio HEAD. Em vez de falhar, deriva a base do histórico.
    if base == git("rev-parse", "HEAD").strip():
        derivada = base_pela_feature(args.feature)
        if derivada is None:
            sys.exit(
                f"erro: {args.base} já contém a feature e nenhum commit carrega o trailer "
                f"'Feature: {args.feature}'.\n"
                "Passe --base apontando para antes do primeiro commit da feature — derivar "
                "pelo escopo recuaria o histórico inteiro e devolveria features alheias."
            )
        base = git("rev-parse", derivada).strip()
        print(
            f"aviso: {args.base} já contém a feature; base derivada do histórico.",
            file=sys.stderr,
        )
        # Trailer adotado no meio da feature deixa commits anteriores fora do intervalo.
        # Silenciar isso seria pior que errar: quem audita acharia que viu tudo.
        anterior = git("log", "-1", "--format=%s", base).strip()
        if f"({args.escopo}):" in anterior:
            print(
                f"aviso: o commit da base — {anterior} — tem o mesmo escopo, sinal de que a\n"
                f"       feature começa antes dela (trailer adotado tarde). A auditoria está\n"
                f"       PARCIAL; passe --base apontando para antes do primeiro commit.",
                file=sys.stderr,
            )

    print(f"base: {base[:9]} {git('log', '-1', '--format=%s', base).strip()}")

    # Escala do intervalo sempre visível: número grande é sinal de base errada, e o leitor
    # merece perceber isso antes de confiar no relatório.
    no_intervalo = len(git("log", "--no-merges", "--format=%h", f"{base}..HEAD").splitlines())
    commits = commits_da_feature(base, args.feature, args.escopo)
    print(f"commits no intervalo: {no_intervalo} | auditados pelo filtro: {len(commits)}\n")

    # chamada -> {sha: linhas adicionadas naquele commit}. Guardar a origem, e não só um
    # número, responde "onde isso entrou" — a pergunta de quem audita. Um total solto
    # engana: mover a linha num refactor dobraria a contagem sem nada ter mudado.
    ocorrencias: dict[str, dict[str, int]] = {}
    assunto_por_sha: dict[str, str] = {}
    commits_com_codigo = 0
    for sha, assunto in commits:
        if not tocou_codigo(sha):
            continue
        commits_com_codigo += 1
        assunto_por_sha[sha] = assunto
        for chamada in chamadas_adicionadas(sha):
            ocorrencias.setdefault(chamada, {})
            ocorrencias[chamada][sha] = ocorrencias[chamada].get(sha, 0) + 1

    # Quarta falha silenciosa: commits auditados, mas nenhum tocou os caminhos de código.
    # Significa CAMINHOS_CODIGO desatualizado (pasta renomeada) ou filtro pegando só
    # documentação — nos dois casos, nada foi realmente examinado.
    if commits_com_codigo == 0:
        sys.exit(
            f"erro: nenhum dos {len(commits)} commits tocou {', '.join(CAMINHOS_CODIGO)}.\n"
            "CAMINHOS_CODIGO desatualizado ou filtro pegando só documentação — isso não é "
            "'feature limpa'."
        )
    print(f"commits que tocaram código: {commits_com_codigo}")

    if not ocorrencias:
        print("nenhuma chamada de saída adicionada.")
        return 0

    nao_declaradas = {c for c in ocorrencias if c not in DECLARADAS}
    for chamada in sorted(ocorrencias):
        marca = "declarada" if chamada in DECLARADAS else "NÃO DECLARADA"
        print(f"  {chamada:<40} {marca}")
        for sha, linhas in ocorrencias[chamada].items():
            plural = "linha" if linhas == 1 else "linhas"
            print(f"      {sha} {assunto_por_sha[sha]}  ({linhas} {plural})")

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
