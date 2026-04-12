import { useEffect, useState } from 'react'
import { Layout, ThemeProvider, type Page } from './components'
import { ManagrSplash } from './components/Logo/ManagrBackdrop'
import { ActivityPage } from './pages/ActivityPage'
import { ExplorerPage } from './pages/ExplorerPage'
import { RulesPage } from './pages/RulesPage'
import { SnapshotsPage } from './pages/SnapshotsPage'

const PAGES: Record<Page, React.FC> = {
  explorer: ExplorerPage,
  rules: RulesPage,
  activity: ActivityPage,
  snapshots: SnapshotsPage,
}

function App() {
  const [loading, setLoading] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)
  const [page, setPage] = useState<Page>('explorer')

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

  const PageComponent = PAGES[page]

  return (
    <ThemeProvider>
      <Layout activePage={page} onNavigate={setPage}>
        <PageComponent />
      </Layout>
    </ThemeProvider>
  )
}

export default App
