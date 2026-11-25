#!/usr/bin/env python3
"""Gera os clipes da página a partir das gravações do painel (material-real/).
Coordenadas em px "CSS" do painel (a gravação é 2x: 2880x1334 = 1440x667).
Saída: src/assets/media/<id>-169|45.(mp4|webm) + poster .jpg. Uso: python3 scripts/clips.py [id ...]"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'material-real')
OUT = os.path.join(ROOT, 'src', 'assets', 'media')
os.makedirs(OUT, exist_ok=True)
MAX_BYTES = 1_450_000

def pan(a, b, t1, t2):
    """posição que fica em `a`, desliza suave até `b` entre t1 e t2 e fica em `b`."""
    s = f"clip((t-{t1})/{t2 - t1},0,1)"
    return f"({a}+({b}-{a})*({s})*({s})*(3-2*({s})))"

# crop: (x, y, w, h) em CSS. Regra: recortar nas bordas dos painéis ou no fim das linhas de texto,
# nunca no meio de uma palavra. Se o recorte não tiver a proporção da saída, completa com a cor do fundo do painel.
# seq: dois recortes do mesmo trecho, com troca suave (xfade) em `at` segundos — sem deslizar por cima do texto.
# speed: < 1 deixa o trecho mais lento (para chegar aos 6 s sem incluir partes que cortariam texto).
CLIPS = {
    # Gerador: gravação nova (156 enviados hoje). Montagem por recortes (ver LAYOUTS): sai o aviso laranja
    # "O próximo envio está atrasado..." e a linha da sessão; a descrição das ofertas quebra em 2 linhas no 4:5.
    'gerador': dict(file='gerador-156.mov..mov', layout=True),
    # começa já na lista "Ofertas capturadas" (antes de 15,5 s aparecem "Formato da imagem" / "Em breve")
    'monitoramento': dict(file='Monitoramento.mov', ss=15.6, t=5.2, blur=[],
        c169=(318, 59, 1080, 608),
        v45=dict(ss=17.0, t=3.9, speed=0.65), c45=(318, 0, 594, 667)),
    'story': dict(file='Story de oferta.mov', ss=13.0, t=7.8, blur=[],
        c169=(318, 0, 1080, 608), c45=(318, 0, 534, 667)),
    'pagina': dict(file='Página de ofertas.mov', ss=12.0, t=7.0, blur=[],
        c169=(302, 0, 1100, 619), c45=(975, 55, 430, 537)),
    'intercalar': dict(file='intercalar sessões - pegar ofertas de um numero e mandar para outro.mov', ss=3.3, t=8.2,
        blur=[(910, 170, 40, 205),   # fotos das sessões na lista
              (305, 266, 596, 72), (1158, 266, 244, 72),  # aviso "Shopee sem credencial" (fora da lista aberta)
              (1158, 184, 70, 38),   # fim do selo "1 loja sem credencial válida"
              (650, 510, 200, 145),  # nomes dos grupos concorrentes monitorados
              (880, 392, 140, 275),  # pedaço do cartão "Grupos monitorados" que ficaria cortado no 4:5
              (1250, 6, 170, 40)],   # "Tenant: ..."
        c169=(902, 101, 502, 282), c45=(902, 100, 502, 567)),
    'tutorial': dict(file='Tutorial passo a passo.mov', ss=1.0, t=9.0,
        blur=[(1250, 6, 170, 40)],   # "Tenant: ..." (no topo, antes de rolar)
        c169=(302, 48, 1100, 619),
        v45=dict(ss=6.5, t=9.0), c45=(296, 104, 368, 460)),   # uma coluna de aulas
}

PAD = '0xF4F6FA'  # fundo do painel

# ---- Montagens: recortes da gravação colados numa tela branca (px CSS) ----
# peça: (x, y, w, h) na gravação → (dx, dy) na tela. Segmentos tocam em sequência ('cut' ou xfade).
def _item(dy, src_dy, split, ws, end, tags_end):
    """Uma oferta da fila no 4:5: título + 1ª linha da descrição (até `split`, num espaço entre palavras),
    2ª linha (da palavra que começa em `ws` até `end`) alinhada embaixo, e as etiquetas."""
    x0 = split + 1
    return [((336, 444 + src_dy, split - 336, 50), (10, dy)),
            ((x0, 472 + src_dy, end - x0 + 4, 22), (60 - (ws - x0), dy + 48)),
            ((380, 495 + src_dy, tags_end - 376, 24), (54, dy + 71))]

# 'still': a peça vem de um quadro parado (3,0 s), sem o cursor do mouse por cima (esse conteúdo não muda)
_G_HEAD_169 = [((322, 232, 538, 50), (20, 22), 'still'),      # "Fila de envio" + subtítulo
               ((1124, 328, 248, 32), (20, 80), 'still'),     # "2 aguardando" "156 enviados hoje"
               ((450, 402, 290, 40), (17, 116)),     # aba "Aguardando (2)"
               ((965, 402, 290, 40), (307, 116)),    # aba "Concluídos hoje (156)"
               ((336, 444, 586, 178), (19, 156))]    # as 2 ofertas (linha inteira)
_G_HEAD_45 = [((322, 232, 102, 24), (14, 0), 'still'),        # "Fila de envio"
              ((322, 260, 207, 20), (14, 26), 'still'),       # "Um envio por vez em cada sessão."
              ((529, 260, 330, 20), (15, 44), 'still'),       # "Continua no servidor mesmo com o navegador fechado."
              ((1124, 328, 248, 32), (14, 76), 'still'),      # selos
              ((500, 402, 190, 40), (14, 118)),      # aba "Aguardando (2)"
              ((1015, 402, 190, 40), (204, 118))]    # aba "Concluídos hoje (156)"

def _g45(splits, tags_end, top=70):
    a, b = splits
    pcs = _G_HEAD_45 + _item(164, 0, *a, tags_end) + _item(274, 90, *b, tags_end)
    return [(p[0], (p[1][0], p[1][1] + top), *p[2:]) for p in pcs]

LAYOUTS = {
    'gerador': {
        '169': dict(canvas=(624, 351), join='cut', still=3.0, segs=[
            dict(ss=3.6, t=3.4, pieces=_G_HEAD_169),                 # Aguardando (2) → clique em Concluídos
            dict(ss=7.0, t=1.9, speed=0.6, pieces=_G_HEAD_169)]),    # Concluídos hoje (156), com "Enviado"
        '45': dict(canvas=(408, 510), join=0.45, still=3.0, segs=[
            dict(ss=3.6, t=2.6, pieces=_g45([(676, 678, 840), (650, 654, 800)], 540)),
            dict(ss=7.0, t=1.9, speed=0.6, pieces=_g45([(699, 702, 914), (711, 714, 910)], 604))]),
    },
}

def layout_graph(L, size):
    """Monta o filtro: entradas 0..n-1 = segmentos; entrada n = quadro parado (L['still']) para as peças 'still'."""
    W, H = L['canvas']
    nseg = len(L['segs'])
    out, segs, durs = [], [], []
    stills = [(i, k) for i, sg in enumerate(L['segs']) for k, pc in enumerate(sg['pieces']) if 'still' in pc[2:]]
    if stills:
        out.append(f"[{nseg}:v]trim=end_frame=1,split={len(stills)}" + ''.join(f"[q{i}_{k}]" for i, k in stills))
    for i, sg in enumerate(L['segs']):
        sp = sg.get('speed', 1.0)
        d = sg['t'] / sp
        durs.append(d)
        live = [k for k, pc in enumerate(sg['pieces']) if 'still' not in pc[2:]]
        out.append(f"[{i}:v]fps=30,setpts=(PTS-STARTPTS)/{sp},split={len(live)}" + ''.join(f"[s{i}_{k}]" for k in live))
        out.append(f"color=c=white:s={W*2}x{H*2}:r=30:d={d:.3f}[c{i}_0]")
        for k, pc in enumerate(sg['pieces']):
            (x, y, w, h), (dx, dy) = pc[:2]
            src = (f"[q{i}_{k}]loop=loop={int(d * 30) + 2}:size=1:start=0,setpts=N/30/TB,crop={w*2}:{h*2}:{x*2}:{y*2}[p{i}_{k}]"
                   if 'still' in pc[2:] else f"[s{i}_{k}]crop={w*2}:{h*2}:{x*2}:{y*2}[p{i}_{k}]")
            out.append(f"{src};[c{i}_{k}][p{i}_{k}]overlay={dx*2}:{dy*2}:shortest=1:eof_action=pass[c{i}_{k+1}]")
        Wo, Ho = size.split(':')
        out.append(f"[c{i}_{len(sg['pieces'])}]scale={Wo}:{Ho}:flags=lanczos,setsar=1,format=yuv420p[g{i}]")
        segs.append(f"[g{i}]")
    if L['join'] == 'cut':
        out.append(''.join(segs) + f"concat=n={len(segs)}:v=1[out]")
        total = sum(durs)
    else:
        xf = L['join']
        out.append(f"[g0][g1]xfade=transition=fade:duration={xf}:offset={durs[0] - xf:.3f}[out]")
        total = sum(durs) - xf
    return ';'.join(out), total

def fit(crop, size):
    x, y, w, h = crop
    W, H = size.split(':')
    return (f"crop={w*2}:{h*2}:{x*2}:{y*2},scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={PAD},setsar=1")

def vf(c, crop, size, speed=1.0):
    parts, last = [], 'b0'
    pre = 'fps=30' + (f',setpts=PTS/{speed}' if speed != 1.0 else '')
    parts.append(f"[0:v]{pre}[b0]")
    for i, (x, y, w, h) in enumerate(c['blur']):
        x, y, w, h = [v * 2 for v in (x, y, w, h)]
        parts.append(f"[{last}]split[m{i}][s{i}];[s{i}]crop={w}:{h}:{x}:{y},boxblur=luma_radius=min(24\\,min(w\\,h)/4):luma_power=3:chroma_radius=min(12\\,min(cw\\,ch)/4):chroma_power=3[k{i}];[m{i}][k{i}]overlay={x}:{y}[b{i+1}]")
        last = f"b{i+1}"
    if isinstance(crop, dict):
        (a, b), at, xf = crop['seq'], crop['at'], 0.45
        parts.append(f"[{last}]split[sa][sb];[sa]{fit(a, size)},trim=0:{at + xf},setpts=PTS-STARTPTS[va];"
                     f"[sb]{fit(b, size)},trim=start={at},setpts=PTS-STARTPTS[vb];"
                     f"[va][vb]xfade=transition=fade:duration={xf}:offset={at},format=yuv420p[out]")
    else:
        parts.append(f"[{last}]{fit(crop, size)},format=yuv420p[out]")
    return ';'.join(parts)

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(r.stderr[-2000:]); sys.exit(1)

def encode(cid, c, tag, crop, size, seg=None):
    base = os.path.join(OUT, f"{cid}-{tag}")
    if c.get('layout'):
        L = LAYOUTS[cid][tag]
        graph, total = layout_graph(L, size)
        inp = ['ffmpeg', '-v', 'error', '-y']
        for sg in L['segs']:
            inp += ['-ss', str(sg['ss']), '-t', str(sg['t']), '-i', os.path.join(SRC, c['file'])]
        if 'still' in L:
            inp += ['-ss', str(L['still']), '-t', '0.2', '-i', os.path.join(SRC, c['file'])]
        t, speed = total, 1.0
    else:
        seg = seg or {}
        ss, t, speed = seg.get('ss', c['ss']), seg.get('t', c['t']), seg.get('speed', 1.0)
        graph = vf(c, crop, size, speed)
        inp = ['ffmpeg', '-v', 'error', '-y', '-ss', str(ss), '-t', str(t), '-i', os.path.join(SRC, c['file'])]
    for crf in (26, 28, 30, 32, 34):
        run(inp + ['-filter_complex', graph, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf),
                   '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', base + '.mp4'])
        if os.path.getsize(base + '.mp4') <= MAX_BYTES: break
    mp4_crf = crf
    for crf in (36, 39, 42, 45):
        run(inp + ['-filter_complex', graph, '-map', '[out]', '-an', '-c:v', 'libvpx-vp9', '-crf', str(crf), '-b:v', '0',
                   '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', base + '.webm'])
        if os.path.getsize(base + '.webm') <= MAX_BYTES: break
    # poster: quadro do meio do clipe
    run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t / speed * 0.6), '-i', base + '.mp4', '-frames:v', '1', '-q:v', '5', base + '.jpg'])
    print(f"{cid}-{tag}: mp4 {os.path.getsize(base+'.mp4')/1e6:.2f} MB (crf {mp4_crf}), webm {os.path.getsize(base+'.webm')/1e6:.2f} MB, poster {os.path.getsize(base+'.jpg')/1e3:.0f} KB", flush=True)

ids = sys.argv[1:] or list(CLIPS)
for cid in ids:
    c = CLIPS[cid]
    encode(cid, c, '169', c.get('c169'), '1280:720')
    encode(cid, c, '45', c.get('c45'), '720:900', c.get('v45'))
