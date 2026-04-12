import { type ReactNode } from 'react'
import styles from './Badge.module.css'

type BadgeVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'ghost'

interface BadgeProps {
  variant?: BadgeVariant
  dot?: boolean
  className?: string
  children: ReactNode
}

export function Badge({ variant = 'primary', dot = false, className = '', children }: BadgeProps) {
  const cls = [styles.badge, styles[variant], className].filter(Boolean).join(' ')

  return (
    <span className={cls}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  )
}
