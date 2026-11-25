// Linha do tempo e geometria da animação "a oferta troca de grupo".
// Tudo é função de um único relógio `t` (segundos dentro do loop), então a cena
// é determinística: com prefers-reduced-motion basta fixar `t` no estado final.

export const STAGE_W = 360
export const STAGE_H = 640

/** Duração do loop (~6 s de ação + respiro). */
export const LOOP = 6.8

export const T = {
  offerIn: 0.35, // oferta surge no grupo da esquerda
  detect: 1.0, // a Rota "pega" a oferta (contorno verde)
  lift: 1.5, // o balão descola
  atNode: 2.35, // chega ao nó CopySync
  scrambleStart: 2.6, // troca de caracteres do link
  scrambleEnd: 3.3,
  leaveNode: 3.8, // sai do nó já com o seu link
  land: 4.6, // aterrissa no Seu Grupo
  toast: 4.8, // "+1 oferta publicada"
  fadeOut: 6.3, // limpa a cena para o próximo loop
} as const

/** Estado final mostrado sem movimento (prefers-reduced-motion). */
export const STATIC_T = 5.6

export const BUBBLE = { w: 148, h: 132 } as const
export const SLOT = {
  left: { x: 16, y: 252 },
  right: { x: 196, y: 252 },
} as const
export const NODE = { x: 180, y: 476, r: 30 } as const
/** A linha de luz só aparece abaixo dos balões (fora dos chats). */
export const LINE_CLIP_Y = 384

// ---------- matemática ----------

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p
/** Progresso 0→1 de `t` entre `a` e `b`. */
export const prog = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
export const easeOut = (p: number) => 1 - (1 - p) ** 3
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
/** Sobe e desce (0→1→0) entre `a` e `b`. */
export const spike = (t: number, a: number, b: number) => {
  const p = prog(t, a, b)
  return p <= 0 || p >= 1 ? 0 : Math.sin(p * Math.PI)
}

// ---------- caminhos ----------

type Pt = readonly [number, number]
type Seg = readonly [Pt, Pt, Pt, Pt]

const straight = (a: Pt, b: Pt): Seg => [
  a,
  [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
  [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3],
  b,
]

const cx = SLOT.left.x + BUBBLE.w / 2 // 90
const rx = SLOT.right.x + BUBBLE.w / 2 // 270
const cy = SLOT.left.y + BUBBLE.h / 2 // 318

/** Do centro do balão da esquerda até o nó. */
export const ROUTE_A: Seg[] = [
  straight([cx, cy], [cx, LINE_CLIP_Y]),
  [
    [cx, LINE_CLIP_Y],
    [cx, 440],
    [115, NODE.y],
    [NODE.x - NODE.r, NODE.y],
  ],
  straight([NODE.x - NODE.r, NODE.y], [NODE.x, NODE.y]),
]

/** Do nó até o centro do balão no Seu Grupo. */
export const ROUTE_B: Seg[] = [
  straight([NODE.x, NODE.y], [NODE.x + NODE.r, NODE.y]),
  [
    [NODE.x + NODE.r, NODE.y],
    [245, NODE.y],
    [rx, 440],
    [rx, LINE_CLIP_Y],
  ],
  straight([rx, LINE_CLIP_Y], [rx, cy]),
]

export function toPathD(segs: Seg[]) {
  return segs
    .map(
      (s, i) =>
        `${i === 0 ? `M ${s[0][0]} ${s[0][1]} ` : ''}C ${s[1][0]} ${s[1][1]}, ${s[2][0]} ${s[2][1]}, ${s[3][0]} ${s[3][1]}`,
    )
    .join(' ')
}

function cubic(s: Seg, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0],
    a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1],
  ]
}

/** Amostrador por comprimento de arco: velocidade constante ao longo do caminho. */
export function makeSampler(segs: Seg[]) {
  const N = 40
  const pts: Pt[] = []
  const acc: number[] = []
  let total = 0
  let prev: Pt | null = null
  segs.forEach((s, si) => {
    for (let i = si === 0 ? 0 : 1; i <= N; i++) {
      const p = cubic(s, i / N)
      if (prev) total += Math.hypot(p[0] - prev[0], p[1] - prev[1])
      pts.push(p)
      acc.push(total)
      prev = p
    }
  })
  return (u: number): Pt => {
    const target = clamp01(u) * total
    let lo = 0
    let hi = acc.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (acc[mid] < target) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return pts[0]
    const a = acc[lo - 1]
    const b = acc[lo]
    const f = b === a ? 0 : (target - a) / (b - a)
    return [lerp(pts[lo - 1][0], pts[lo][0], f), lerp(pts[lo - 1][1], pts[lo][1], f)]
  }
}

// ---------- textos animados ----------

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@'

/** `afiliado=OUTRO` → `afiliado=VOCÊ` com troca de caracteres determinística. */
export function scrambleAt(t: number) {
  const from = 'OUTRO'
  const to = 'VOCÊ'
  if (t < T.scrambleStart) return from
  if (t >= T.scrambleEnd) return to
  const p = prog(t, T.scrambleStart, T.scrambleEnd)
  const len = p < 0.6 ? from.length : to.length
  const resolved = Math.floor(clamp01((p - 0.35) / 0.65) * (to.length + 1))
  const frame = Math.floor(t * 22)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += i < resolved ? to[i] : GLYPHS[(frame * 7 + i * 11 + frame * i * 3) % GLYPHS.length]
  }
  return out
}

/** 00:04,2 */
export function formatTimer(seconds: number) {
  const tenths = Math.round(seconds * 10)
  const m = Math.floor(tenths / 600)
  const s = (tenths % 600) / 10
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0').replace('.', ',')}`
}
