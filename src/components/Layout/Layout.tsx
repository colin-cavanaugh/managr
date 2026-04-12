import { type ReactNode } from 'react'
import { LogoHorizontal, LogoIcon } from '../Logo/ManagrLogo'
import { Toggle } from '../Toggle/Toggle'
import { useTheme } from '../theme/ThemeProvider'
import { defaultTheme, lightTheme } from '../theme/theme'
import styles from './Layout.module.css'

export type Page = 'explorer' | 'rules' | 'activity' | 'snapshots'

interface LayoutProps {
  activePage: Page
  onNavigate: (page: Page) => void
  children: ReactNode
}

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'explorer', label: 'Explorer', icon: '⬡' },
  { id: 'rules', label: 'Rules', icon: '⚙' },
  { id: 'activity', label: 'Activity', icon: '▸' },
  { id: 'snapshots', label: 'Snapshots', icon: '⟲' },
]

const PAGE_TITLES: Record<Page, string> = {
  explorer: 'Directory Explorer',
  rules: 'Automation Rules',
  activity: 'Activity Log',
  snapshots: 'Snapshots & Rollback',
}

export function Layout({ activePage, onNavigate, children }: LayoutProps) {
  const { theme, setTheme } = useTheme()
  const isDark = theme.bg === defaultTheme.bg

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          {/* Full logo at wide, icon-only at narrow (CSS handles visibility) */}
          <span className={styles.logoFull}><LogoHorizontal height={32} darkMode={isDark} /></span>
          <span className={styles.logoIcon}><LogoIcon size={32} darkMode={isDark} /></span>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`${styles.navItem} ${activePage === item.id ? styles.active : ''}`}
              onClick={() => onNavigate(item.id)}
              title={item.label}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <Toggle
            checked={isDark}
            onChange={() => setTheme(isDark ? lightTheme : defaultTheme)}
            label={isDark ? 'Dark' : 'Light'}
          />
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.pageTitle}>{PAGE_TITLES[activePage]}</h1>
        </header>
        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  )
}
