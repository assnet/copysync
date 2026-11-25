// Ícones da página de Planos. WhatsApp e Telegram: mesmos desenhos e cores do app (só na tabela de canais).
import channelIcons from '../../assets/channel_icons.json'

export const CHANNEL_COLOR = { whatsapp: '#128C7E', telegram: '#0088CC' } as const

export function ChannelIcon({
  channel,
  className = 'size-4',
  muted = false,
}: {
  channel: 'whatsapp' | 'telegram'
  className?: string
  muted?: boolean
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={channelIcons[channel]} fill={muted ? '#a9adba' : CHANNEL_COLOR[channel]} />
    </svg>
  )
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function CheckMark({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2.6}>
      <path d="m4.5 12.5 4.5 4.5L19.5 7" />
    </svg>
  )
}

export function CrownIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2}>
      <path d="M3.5 8 7.5 12 12 5.5 16.5 12l4-4-1.8 10.5H5.3L3.5 8Z" />
      <path d="M5.5 21h13" />
    </svg>
  )
}

export function SessionsIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2.2}>
      <path d="M7 4 3.5 7.5 7 11" />
      <path d="M3.5 7.5h13" />
      <path d="m17 13 3.5 3.5L17 20" />
      <path d="M20.5 16.5h-13" />
    </svg>
  )
}

export function ChannelsIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2}>
      <path d="M4 5.5h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 14 14.5H8L4.5 17.5v-3H4A1.5 1.5 0 0 1 2.5 13V7A1.5 1.5 0 0 1 4 5.5Z" />
      <path d="M18 9h2a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 20 18h-.5v3L16 18h-4.5" />
    </svg>
  )
}

export function LockIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function RefreshIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4.5v4.5h-4.5" />
    </svg>
  )
}

export function TrendIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2}>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  )
}

export function HeadsetIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2}>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="13.5" width="4" height="6" rx="1.5" />
      <rect x="17" y="13.5" width="4" height="6" rx="1.5" />
      <path d="M19 19.5c0 1.4-1.6 2-4 2h-2" />
    </svg>
  )
}

export function CheckCircleIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...base} className={className} strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.7 2.7L16.3 9.5" />
    </svg>
  )
}
