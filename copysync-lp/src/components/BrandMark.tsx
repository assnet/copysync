import icon from '../assets/brand/copysync-icon.png'
import logo from '../assets/brand/copysync-logo.png'

export function BrandMark({ className = '' }: { className?: string }) {
  // Arquivo original: 2172×724 (proporção 3:1)
  return <img src={logo} alt="CopySync" width={156} height={52} className={`h-[52px] w-[156px] ${className}`} />
}

export function BrandIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <img src={icon} alt="" width={size} height={size} className={className} style={{ width: size, height: size }} />
}
