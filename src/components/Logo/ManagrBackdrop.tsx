import { type CSSProperties, type ReactNode } from 'react'
import { LogoPrimary } from './ManagrLogo'

const COLORS = {
  accent: '#948979',
  bg: '#222831',
}

// ─── Backdrop ───────────────────────────────────────────────────────────────

interface BackdropProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export default function ManagrBackdrop({ children, className = '', style = {} }: BackdropProps) {
  return (
    <div className={className} style={{ position: 'relative', width: '100%', minHeight: '100vh', background: COLORS.bg, overflow: 'hidden', ...style }}>
      {/* Subtle grain texture */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.035'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat', backgroundSize: '128px', pointerEvents: 'none', zIndex: 1,
      }} />

      {/* Vignette */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(15,17,22,0.5) 100%)',
        pointerEvents: 'none', zIndex: 2,
      }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 10 }}>{children}</div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Splash screen ──────────────────────────────────────────────────────────

export function ManagrSplash() {
  return (
    <ManagrBackdrop>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh', padding: '2rem',
        textAlign: 'center', gap: 0,
      }}>
        <div style={{ animation: 'fadeSlideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.2s both' }}>
          <LogoPrimary width={380} darkMode />
        </div>

        {/* Loading dots */}
        <div style={{
          display: 'flex', gap: '8px', marginTop: '2.5rem',
          animation: 'fadeSlideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.7s both',
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: '50%', background: COLORS.accent,
              animation: `pulseDot 1.4s ease-in-out ${i * 0.22}s infinite`,
            }} />
          ))}
        </div>
      </div>
    </ManagrBackdrop>
  )
}
