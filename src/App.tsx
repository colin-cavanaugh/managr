import { useEffect, useState, useRef, useCallback } from 'react'
import { Layout, ThemeProvider, type Page } from './components'
import { ManagrSplash } from './components/Logo/ManagrBackdrop'
import { ActivityPage } from './pages/ActivityPage'
import { ExplorerPage } from './pages/ExplorerPage'
import { RulesPage } from './pages/RulesPage'
import { SnapshotsPage } from './pages/SnapshotsPage'

function App() {
  const [loading, setLoading] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)
  const [page, setPage] = useState<Page>('explorer')
  const [currentDir, setCurrentDir] = useState('')

  // Allows Layout sidebar to tell Explorer to navigate
  const pendingNav = useRef<string | null>(null)
  const [navTrigger, setNavTrigger] = useState(0)

  const handleNavigateToDir = useCallback((dirPath: string) => {
    pendingNav.current = dirPath
    setNavTrigger(n => n + 1)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true)
      setTimeout(() => setLoading(false), 600)
    }, 2200)
    return () => clearTimeout(timer)
  }, [])

  if (loading) {
    return (
      <div style={{
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.6s ease',
      }}>
        <ManagrSplash />
      </div>
    )
  }

  return (
    <ThemeProvider>
      <Layout activePage={page} onNavigate={setPage} onNavigateToDir={handleNavigateToDir} currentDir={currentDir}>
        {page === 'explorer' && (
          <ExplorerPage
            onPathChange={setCurrentDir}
            externalNav={pendingNav.current}
            externalNavTrigger={navTrigger}
          />
        )}
        {page === 'rules' && <RulesPage />}
        {page === 'activity' && <ActivityPage />}
        {page === 'snapshots' && <SnapshotsPage />}
      </Layout>
    </ThemeProvider>
  )
}

export default App
