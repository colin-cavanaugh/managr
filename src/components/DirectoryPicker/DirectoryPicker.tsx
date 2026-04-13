import { useState, useEffect } from 'react'
import { Button } from '../Button/Button'
import { Modal } from '../Modal/Modal'
import { api, type FileEntry, type PlatformInfo } from '../../api/client'
import styles from './DirectoryPicker.module.css'

interface DirectoryPickerProps {
  value: string
  onChange: (path: string) => void
  placeholder?: string
  className?: string
}

interface QuickPath {
  label: string
  path: string
}

function buildQuickPaths(platform: PlatformInfo): QuickPath[] {
  const paths: QuickPath[] = []

  if (platform.os === 'wsl' && platform.windowsHome) {
    const wh = platform.windowsHome
    paths.push(
      { label: 'Windows Home', path: wh },
      { label: 'Desktop', path: `${wh}/Desktop` },
      { label: 'Downloads', path: `${wh}/Downloads` },
      { label: 'Documents', path: `${wh}/Documents` },
      { label: 'Pictures', path: `${wh}/Pictures` },
      { label: 'Linux Home', path: platform.linuxHome },
    )
  } else if (platform.os === 'mac') {
    const h = platform.defaultHome
    paths.push(
      { label: 'Home', path: h },
      { label: 'Desktop', path: `${h}/Desktop` },
      { label: 'Downloads', path: `${h}/Downloads` },
      { label: 'Documents', path: `${h}/Documents` },
      { label: 'Pictures', path: `${h}/Pictures` },
    )
  } else {
    const h = platform.defaultHome
    paths.push(
      { label: 'Home', path: h },
      { label: 'Desktop', path: `${h}/Desktop` },
      { label: 'Downloads', path: `${h}/Downloads` },
      { label: 'Documents', path: `${h}/Documents` },
      { label: 'Pictures', path: `${h}/Pictures` },
    )
  }

  return paths
}

export function DirectoryPicker({ value, onChange, placeholder = 'Choose a directory...', className = '' }: DirectoryPickerProps) {
  const [open, setOpen] = useState(false)
  const [browsePath, setBrowsePath] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<PlatformInfo | null>(null)
  const [quickPaths, setQuickPaths] = useState<QuickPath[]>([])
  const [drives, setDrives] = useState<{ label: string; path: string; type: string }[]>([])

  // Fetch platform info and drives once
  useEffect(() => {
    api.platform().then(info => {
      setPlatform(info)
      setQuickPaths(buildQuickPaths(info))
    }).catch(() => {
      setQuickPaths([{ label: 'Home', path: '' }])
    })
    api.drives().then(setDrives).catch(() => {})
  }, [])

  const loadDir = async (dirPath: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.files.list(dirPath || undefined)
      setBrowsePath(result.path)
      setParentPath(result.parent)
      setEntries(result.entries.filter(e => e.type === 'directory'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      // Default to the platform's home when opening fresh
      const startPath = value || (platform?.defaultHome ?? '')
      loadDir(startPath)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSelect = () => {
    onChange(browsePath)
    setOpen(false)
  }

  const dirCount = entries.length

  return (
    <>
      <button
        type="button"
        className={`${styles.trigger} ${className}`}
        onClick={() => setOpen(true)}
      >
        <span className={styles.triggerIcon}>📁</span>
        <span className={`${styles.triggerText} ${!value ? styles.placeholder : ''}`}>
          {value || placeholder}
        </span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Choose Directory"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSelect}>
              Select "{browsePath.split('/').pop() || '/'}"
            </Button>
          </>
        }
      >
        <div className={styles.browser}>
          {/* Platform indicator */}
          {platform && platform.os === 'wsl' && (
            <div className={styles.platformNote}>
              WSL detected — showing Windows & Linux directories
            </div>
          )}

          {/* Drives */}
          {drives.length > 0 && (
            <div className={styles.quickNav}>
              {drives.map(d => (
                <button
                  key={d.path}
                  className={styles.quickNavBtn}
                  onClick={() => loadDir(d.path)}
                >
                  {d.type === 'drive' ? '💾' : d.type === 'home' ? '🏠' : '📂'} {d.label}
                </button>
              ))}
            </div>
          )}

          {/* Quick nav */}
          <div className={styles.quickNav}>
            {quickPaths.map(qp => (
              <button
                key={qp.label}
                className={styles.quickNavBtn}
                onClick={() => loadDir(qp.path)}
              >
                {qp.label}
              </button>
            ))}
          </div>

          {/* Current path */}
          <div className={styles.currentPath}>
            📍 <strong>{browsePath || '/'}</strong>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {loading ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <>
              <ul className={styles.dirList}>
                {/* Up one level */}
                {parentPath !== browsePath && (
                  <li
                    className={`${styles.dirItem} ${styles.upItem}`}
                    onClick={() => loadDir(parentPath)}
                  >
                    <span className={styles.dirIcon}>↑</span>
                    <span className={styles.dirName}>.. (up one level)</span>
                  </li>
                )}

                {entries.length === 0 && (
                  <li className={styles.dirItem} style={{ color: 'var(--mgr-text-muted)', cursor: 'default' }}>
                    No subdirectories
                  </li>
                )}

                {entries.map(entry => (
                  <li
                    key={entry.path}
                    className={styles.dirItem}
                    onClick={() => loadDir(entry.path)}
                  >
                    <span className={styles.dirIcon}>📁</span>
                    <span className={styles.dirName}>{entry.name}</span>
                  </li>
                ))}
              </ul>

              <div className={styles.fileCount}>
                {dirCount} folder{dirCount !== 1 ? 's' : ''} in this directory
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
