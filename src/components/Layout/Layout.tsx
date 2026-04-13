import { useEffect, useState, type ReactNode } from 'react'
import { LogoHorizontal, LogoIcon } from '../Logo/ManagrLogo'
import { Toggle } from '../Toggle/Toggle'
import { useTheme } from '../theme/ThemeProvider'
import { defaultTheme, lightTheme } from '../theme/theme'
import { api } from '../../api/client'
import styles from './Layout.module.css'

export type Page = 'explorer' | 'rules' | 'activity' | 'snapshots'

interface LayoutProps {
  activePage: Page
  onNavigate: (page: Page) => void
  onNavigateToDir?: (path: string) => void
  currentDir?: string
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

interface FrequentDir { path: string; visitCount: number }
interface PinnedDir { id: string; path: string; label: string }

function dirName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p
}

export function Layout({ activePage, onNavigate, onNavigateToDir, currentDir, children }: LayoutProps) {
  const { theme, setTheme } = useTheme()
  const isDark = theme.bg === defaultTheme.bg

  const [frequent, setFrequent] = useState<FrequentDir[]>([])
  const [pinned, setPinned] = useState<PinnedDir[]>([])

  const refreshLists = () => {
    api.dirs.frequent().then(setFrequent).catch(() => {})
    api.dirs.pinned().then(setPinned).catch(() => {})
  }

  useEffect(() => { refreshLists() }, [activePage])

  const handleDirClick = (dirPath: string) => {
    onNavigate('explorer')
    onNavigateToDir?.(dirPath)
  }

  const handlePin = () => {
    if (!currentDir) return
    api.dirs.pin(currentDir).then(() => refreshLists()).catch(() => {})
  }

  const handleUnpin = (dirPath: string) => {
    api.dirs.unpin(dirPath).then(() => refreshLists()).catch(() => {})
  }

  const isCurrentPinned = pinned.some(p => p.path === currentDir)

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
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

        {/* Frequent directories */}
        {frequent.length > 0 && (
          <div className={styles.sidebarSection}>
            <div className={styles.sidebarSectionTitle}>Frequent</div>
            {frequent.map(f => (
              <button key={f.path} className={styles.dirItem} onClick={() => handleDirClick(f.path)} title={f.path}>
                <span>📁</span>
                <span className={styles.dirItemLabel}>{dirName(f.path)}</span>
                <span className={styles.dirItemCount}>{f.visitCount}</span>
              </button>
            ))}
          </div>
        )}

        {/* Pinned directories (Quick Nav) */}
        <div className={styles.sidebarSection}>
          <div className={styles.sidebarSectionTitle}>Quick Nav</div>
          {pinned.map(p => (
            <button key={p.id} className={styles.dirItem} onClick={() => handleDirClick(p.path)} title={p.path}>
              <span>📌</span>
              <span className={styles.dirItemLabel}>{p.label}</span>
              <button className={styles.unpinBtn} onClick={e => { e.stopPropagation(); handleUnpin(p.path) }} title="Unpin">×</button>
            </button>
          ))}
          {currentDir && !isCurrentPinned && activePage === 'explorer' && (
            <button className={styles.pinBtn} onClick={handlePin}>
              + Pin current directory
            </button>
          )}
          {pinned.length === 0 && (!currentDir || activePage !== 'explorer') && (
            <div style={{ fontSize: 11, color: 'var(--mgr-text-muted)', padding: '4px 12px' }}>
              Navigate to a directory and pin it here
            </div>
          )}
        </div>

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
