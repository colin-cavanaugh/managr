import { LogoIcon } from '../Logo/ManagrLogo'
import { useTheme } from '../theme/ThemeProvider'
import { defaultTheme } from '../theme/theme'
import styles from './Loader.module.css'

interface LoaderProps {
  text?: string
  size?: 'default' | 'inline'
  className?: string
}

export function Loader({ text = 'Loading...', size = 'default', className = '' }: LoaderProps) {
  const { theme } = useTheme()
  const isDark = theme.bg === defaultTheme.bg

  if (size === 'inline') {
    return (
      <div className={`${styles.loader} ${styles.inline} ${className}`}>
        <div className={styles.icon}>
          <LogoIcon size={16} darkMode={isDark} />
        </div>
        <span className={styles.text}>{text}</span>
        <div className={styles.inlineDots}>
          <div className={styles.inlineDot} />
          <div className={styles.inlineDot} />
          <div className={styles.inlineDot} />
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.loader} ${className}`}>
      <div className={styles.icon}>
        <LogoIcon size={40} darkMode={isDark} />
      </div>
      <div className={styles.dots}>
        <div className={styles.dot} />
        <div className={styles.dot} />
        <div className={styles.dot} />
      </div>
      {text && <span className={styles.text}>{text}</span>}
    </div>
  )
}
