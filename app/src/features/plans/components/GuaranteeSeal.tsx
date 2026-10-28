import { Box, useTheme } from '@mui/material';
import { plansStrings as t } from '../strings';

/** Starburst raso (medalha), gerado uma vez. */
function buildBurst(cx: number, cy: number, teeth: number, ro: number, ri: number): string {
  let d = '';
  const n = teeth * 2;
  for (let i = 0; i < n; i++) {
    const r = i % 2 ? ri : ro;
    const a = (Math.PI / teeth) * i - Math.PI / 2;
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}
const SEAL_BURST = buildBurst(60, 60, 46, 60, 53.5);

interface Props {
  size?: number;
}

/** Selo "7 dias de garantia": dourado sobre disco escuro, legível nos dois modos. */
export function GuaranteeSeal({ size = 120 }: Props) {
  const theme = useTheme();
  const disc = theme.palette.mode === 'dark' ? ['#1c2c4f', '#0a1122'] : ['#263a66', '#121c33'];
  return (
    <Box
      component="svg"
      viewBox="0 0 120 120"
      role="img"
      aria-label={t.guarantee.aria}
      sx={{ width: size, height: size, filter: 'drop-shadow(0 10px 18px rgba(20,16,0,0.35))', transform: 'rotate(-12deg)' }}
    >
      <defs>
        <linearGradient id="plans-seal-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7E29A" />
          <stop offset=".45" stopColor="#E4B44C" />
          <stop offset="1" stopColor="#B27E28" />
        </linearGradient>
        <radialGradient id="plans-seal-disc" cx="50%" cy="36%" r="78%">
          <stop offset="0" stopColor={disc[0]} />
          <stop offset="1" stopColor={disc[1]} />
        </radialGradient>
        <path id="plans-seal-top" d="M60 60 m-36 0 a36 36 0 0 1 72 0" fill="none" />
      </defs>
      <path d={SEAL_BURST} fill="url(#plans-seal-gold)" />
      <circle cx="60" cy="60" r="52.5" fill="url(#plans-seal-gold)" />
      <circle cx="60" cy="60" r="48" fill="url(#plans-seal-disc)" />
      <circle cx="60" cy="60" r="43" fill="none" stroke="url(#plans-seal-gold)" strokeWidth="0.9" opacity=".45" />
      <text fill="url(#plans-seal-gold)" style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.18em' }}>
        <textPath href="#plans-seal-top" startOffset="50%" textAnchor="middle">
          ★ {t.guarantee.ribbon.toUpperCase()} ★
        </textPath>
      </text>
      <text x="60" y="72" textAnchor="middle" fill="url(#plans-seal-gold)" style={{ fontSize: 40, fontWeight: 800 }}>
        {t.guarantee.days}
      </text>
      <text x="61" y="87" textAnchor="middle" fill="url(#plans-seal-gold)" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.36em' }}>
        {t.guarantee.daysLabel.toUpperCase()}
      </text>
      <text x="60" y="98" textAnchor="middle" fill="url(#plans-seal-gold)" style={{ fontSize: 7.5, letterSpacing: '.3em' }}>
        ★ ★ ★
      </text>
    </Box>
  );
}
