import type { CSSProperties } from 'react'

const COLORS = {
  charcoal: '#222831',
  slate: '#393E46',
  khaki: '#948979',
  sand: '#DFD0B8',
}

interface LogoProps {
  darkMode?: boolean
  className?: string
  style?: CSSProperties
}

interface PrimaryProps extends LogoProps {
  width?: number
}

interface HorizontalProps extends LogoProps {
  height?: number
}

interface IconProps extends LogoProps {
  size?: number
}

export function LogoPrimary({ width = 320, darkMode = false, className = '', style = {} }: PrimaryProps) {
  const textColor = darkMode ? COLORS.sand : COLORS.charcoal
  const mutedColor = darkMode ? COLORS.khaki : COLORS.khaki
  const bgColor = darkMode ? COLORS.khaki : COLORS.slate

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={width * (200 / 320)}
      viewBox="0 0 320 200"
      role="img"
      aria-label="managr — file automation simplified"
      className={className}
      style={style}
    >
      <title>managr</title>
      <rect x="112" y="8" width="96" height="96" rx="22" fill={bgColor} />
      <rect x="138" y="28" width="44" height="56" rx="5" fill={COLORS.sand} />
      <polygon points="166,28 182,28 182,44" fill={bgColor} />
      <line x1="166" y1="28" x2="166" y2="44" stroke={COLORS.sand} strokeWidth="1" />
      <line x1="166" y1="44" x2="182" y2="44" stroke={COLORS.sand} strokeWidth="1" />
      <line x1="144" y1="68" x2="168" y2="68" stroke={COLORS.charcoal} strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M163 63 L170 68 L163 73"
        fill="none"
        stroke={COLORS.charcoal}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="160"
        y="145"
        fontFamily="'Roboto', system-ui, sans-serif"
        fontWeight="900"
        fontSize="52"
        letterSpacing="-1"
        fill={textColor}
        textAnchor="middle"
      >
        managr
      </text>
      <text
        x="160"
        y="170"
        fontFamily="'Roboto', system-ui, sans-serif"
        fontWeight="400"
        fontSize="11"
        letterSpacing="4"
        fill={mutedColor}
        textAnchor="middle"
      >
        FILE AUTOMATION · SIMPLIFIED
      </text>
    </svg>
  )
}

export function LogoHorizontal({ height = 52, darkMode = false, className = '', style = {} }: HorizontalProps) {
  const width = height * (260 / 52)
  const textColor = darkMode ? COLORS.sand : COLORS.charcoal
  const bgColor = darkMode ? COLORS.khaki : COLORS.slate

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 260 52"
      role="img"
      aria-label="managr"
      className={className}
      style={style}
    >
      <title>managr</title>
      <rect x="0" y="4" width="44" height="44" rx="10" fill={bgColor} />
      <rect x="10" y="12" width="20" height="28" rx="2.5" fill={COLORS.sand} />
      <polygon points="22,12 30,12 30,20" fill={bgColor} />
      <line x1="22" y1="12" x2="22" y2="20" stroke={COLORS.sand} strokeWidth="0.75" />
      <line x1="22" y1="20" x2="30" y2="20" stroke={COLORS.sand} strokeWidth="0.75" />
      <line x1="12" y1="34" x2="24" y2="34" stroke={COLORS.charcoal} strokeWidth="1.75" strokeLinecap="round" />
      <path
        d="M21 30 L26 34 L21 38"
        fill="none"
        stroke={COLORS.charcoal}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="56"
        y="36"
        fontFamily="'Roboto', system-ui, sans-serif"
        fontWeight="900"
        fontSize="26"
        letterSpacing="0"
        fill={textColor}
      >
        managr
      </text>
    </svg>
  )
}

export function LogoIcon({ size = 96, darkMode = false, className = '', style = {} }: IconProps) {
  const bgColor = darkMode ? COLORS.khaki : COLORS.slate

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="img"
      aria-label="managr icon"
      className={className}
      style={style}
    >
      <title>managr icon</title>
      <rect x="0" y="0" width="96" height="96" rx="22" fill={bgColor} />
      <rect x="22" y="18" width="44" height="56" rx="5" fill={COLORS.sand} />
      <polygon points="50,18 66,18 66,34" fill={bgColor} />
      <line x1="50" y1="18" x2="50" y2="34" stroke={COLORS.sand} strokeWidth="1.25" />
      <line x1="50" y1="34" x2="66" y2="34" stroke={COLORS.sand} strokeWidth="1.25" />
      <line x1="28" y1="58" x2="54" y2="58" stroke={COLORS.charcoal} strokeWidth="3" strokeLinecap="round" />
      <path
        d="M49 52 L57 58 L49 64"
        fill="none"
        stroke={COLORS.charcoal}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
