import { type ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  title?: string
  actions?: ReactNode
  footer?: ReactNode
  compact?: boolean
  className?: string
  children: ReactNode
}

export function Card({ title, actions, footer, compact = false, className = '', children }: CardProps) {
  const cls = [styles.card, compact ? styles.compact : '', className].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      {(title || actions) && (
        <div className={styles.header}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {actions && <div>{actions}</div>}
        </div>
      )}
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  )
}
