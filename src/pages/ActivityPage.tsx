import { useState, useEffect } from 'react'
import { Badge, Select } from '../components'
import { api, type ActivityEntry } from '../api/client'
import styles from './ActivityPage.module.css'

const ACTION_LABELS: Record<string, string> = {
  move: 'Moved',
  copy: 'Copied',
  rename: 'Renamed',
  delete: 'Deleted',
  backup: 'Backed up',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString()
}

export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  const fetchActivity = async () => {
    try {
      const result = await api.activity.list(100)
      setEntries(result.entries)
    } catch {
      // silently fail — empty list shown
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchActivity() }, [])

  const filtered = filter === 'all' ? entries : entries.filter(e => e.status === filter)

  if (loading) return <div style={{ color: 'var(--mgr-text-muted)', padding: 32 }}>Loading activity...</div>

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.count}>{filtered.length} entries</span>
        <Select
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'success', label: 'Success' },
            { value: 'error', label: 'Errors' },
            { value: 'rolled_back', label: 'Rolled back' },
          ]}
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {entries.length === 0
            ? 'No activity yet. Run a rule or start the watcher to see actions here.'
            : 'No entries match the current filter.'}
        </div>
      ) : (
        <div className={styles.feed}>
          {filtered.map(entry => (
            <div key={entry.id} className={styles.entry}>
              <div className={`${styles.entryIcon} ${
                entry.status === 'success' ? styles.iconSuccess :
                entry.status === 'error' ? styles.iconError : styles.iconRollback
              }`}>
                {entry.status === 'success' ? '✓' : entry.status === 'error' ? '!' : '⟲'}
              </div>
              <div className={styles.entryInfo}>
                <p className={styles.entryAction}>
                  {ACTION_LABELS[entry.action] ?? entry.action}{' '}
                  {entry.ruleName && <span style={{ fontWeight: 400, color: 'var(--mgr-text-muted)' }}>via {entry.ruleName}</span>}
                </p>
                <p className={styles.entryPath}>
                  {entry.sourcePath}
                  {entry.destPath && <> → {entry.destPath}</>}
                </p>
                {entry.error && <p className={styles.entryPath} style={{ color: 'var(--mgr-danger)' }}>{entry.error}</p>}
              </div>
              <div className={styles.entryMeta}>
                <Badge variant={entry.status === 'success' ? 'success' : entry.status === 'error' ? 'danger' : 'info'}>
                  {entry.status.replace('_', ' ')}
                </Badge>
                <span className={styles.entryTime}>{formatTime(entry.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
