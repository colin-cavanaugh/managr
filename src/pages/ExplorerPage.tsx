import { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Select, Badge, Modal, Input, DirectoryPicker, FileIcon, Loader } from '../components'
import { api, type DirectoryListing, type DirectoryAnalysis } from '../api/client'
import styles from './ExplorerPage.module.css'

function humanSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

const ACTION_TYPES = [
  { value: 'move', label: 'Move' },
  { value: 'copy', label: 'Copy' },
  { value: 'rename', label: 'Rename' },
  { value: 'delete', label: 'Delete' },
  { value: 'backup', label: 'Backup' },
]

const TRIGGER_OPTIONS = [
  { value: 'file_created', label: 'File created' },
  { value: 'file_modified', label: 'File modified' },
  { value: 'manual', label: 'Manual' },
]

export function ExplorerPage() {
  const [currentPath, setCurrentPath] = useState('')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [analysis, setAnalysis] = useState<DirectoryAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deepScan, setDeepScan] = useState(false)
  const [deepScanning, setDeepScanning] = useState(false)

  // Cache: path → { listing, analysis, dirSizes }
  const cache = useRef<Record<string, { listing: DirectoryListing; analysis: DirectoryAnalysis; dirSizes: Record<string, number> }>>({})

  // Lazy dir sizes
  const [dirSizes, setDirSizes] = useState<Record<string, number>>({})
  const [sizesLoading, setSizesLoading] = useState(false)
  const sizeAbort = useRef<AbortController | null>(null)

  const stopLoadingSizes = () => {
    sizeAbort.current?.abort()
    setSizesLoading(false)
  }

  useEffect(() => {
    if (!listing) return
    sizeAbort.current?.abort()
    const controller = new AbortController()
    sizeAbort.current = controller
    setDirSizes({})
    const dirs = listing.entries.filter(e => e.type === 'directory')
    if (dirs.length === 0) return
    setSizesLoading(true)
    ;(async () => {
      for (const dir of dirs) {
        if (controller.signal.aborted) return
        try {
          const result = await api.files.size(dir.path)
          if (controller.signal.aborted) return
          setDirSizes(prev => ({ ...prev, [dir.path]: result.size }))
        } catch { /* skip */ }
      }
      setSizesLoading(false)
    })()
    return () => controller.abort()
  }, [listing])

  // Sorting
  type SortField = 'name' | 'size' | 'modified' | 'accessed' | 'type'
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(field === 'name') }
  }

  const sortedEntries = listing ? [...listing.entries].sort((a, b) => {
    // Directories always first
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    let cmp = 0
    switch (sortField) {
      case 'name': cmp = a.name.localeCompare(b.name); break
      case 'size': {
        const aSize = a.type === 'directory' ? (dirSizes[a.path] ?? 0) : a.size
        const bSize = b.type === 'directory' ? (dirSizes[b.path] ?? 0) : b.size
        cmp = aSize - bSize; break
      }
      case 'modified': cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime(); break
      case 'accessed': cmp = new Date(a.accessed).getTime() - new Date(b.accessed).getTime(); break
      case 'type': cmp = a.extension.localeCompare(b.extension); break
    }
    return sortAsc ? cmp : -cmp
  }) : []

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedIdx = useRef<number | null>(null)

  // Ref to current visible (sorted) entries so shift-select uses the right order
  const visibleEntries = useRef<{ path: string }[]>([])
  visibleEntries.current = sortedEntries

  const toggleSelect = (entryPath: string, idx: number, shiftKey: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (shiftKey && lastClickedIdx.current !== null) {
        const start = Math.min(lastClickedIdx.current, idx)
        const end = Math.max(lastClickedIdx.current, idx)
        for (let i = start; i <= end; i++) {
          if (visibleEntries.current[i]) {
            next.add(visibleEntries.current[i].path)
          }
        }
      } else {
        if (next.has(entryPath)) next.delete(entryPath)
        else next.add(entryPath)
      }
      lastClickedIdx.current = idx
      return next
    })
  }

  const selectAll = () => {
    if (!listing) return
    if (selected.size === listing.entries.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(listing.entries.map(e => e.path)))
    }
  }

  // Auto-load default directory on mount
  useEffect(() => {
    api.platform().then(info => {
      if (info.defaultHome) loadDirectory(info.defaultHome)
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Single file actions
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [moveDest, setMoveDest] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deletePermanent, setDeletePermanent] = useState(false)

  // Bulk actions
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkMoveDest, setBulkMoveDest] = useState('')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeletePermanent, setBulkDeletePermanent] = useState(false)

  // Quick rule
  const [showQuickRule, setShowQuickRule] = useState(false)
  const [ruleExt, setRuleExt] = useState('')
  const [ruleName, setRuleName] = useState('')
  const [ruleAction, setRuleAction] = useState('move')
  const [ruleDest, setRuleDest] = useState('')
  const [ruleTrigger, setRuleTrigger] = useState('file_created')
  const [ruleCreated, setRuleCreated] = useState(false)

  const loadDirectory = useCallback(async (dirPath: string, skipCache = false) => {
    if (!dirPath) return

    // Check cache first
    if (!skipCache && cache.current[dirPath]) {
      const cached = cache.current[dirPath]
      setListing(cached.listing)
      setAnalysis(cached.analysis)
      setDirSizes(cached.dirSizes)
      setCurrentPath(dirPath)
      setSelected(new Set())
      setDeepScan(false)
      return
    }

    setListing(null)
    setAnalysis(null)
    setSelected(new Set())
    lastClickedIdx.current = null
    setLoading(true)
    setError(null)
    setDeepScan(false)
    setCurrentPath(dirPath)
    try {
      const [listResult, analysisResult] = await Promise.all([
        api.files.list(dirPath),
        api.files.analyze(dirPath),
      ])
      setListing(listResult)
      setAnalysis(analysisResult)
      setCurrentPath(listResult.path)
      // Cache will be updated once dir sizes load too (in the effect)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Save to cache when dir sizes finish loading
  useEffect(() => {
    if (currentPath && listing && analysis && !sizesLoading) {
      cache.current[currentPath] = { listing, analysis, dirSizes }
    }
  }, [currentPath, listing, analysis, dirSizes, sizesLoading])

  const handleDeepScan = async () => {
    if (!currentPath) return
    setDeepScanning(true)
    try {
      const result = await api.files.analyze(currentPath, true)
      setAnalysis(result)
      setDeepScan(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeepScanning(false)
    }
  }

  const handlePickDirectory = (dirPath: string) => loadDirectory(dirPath)
  const navigateTo = (dir: string) => loadDirectory(dir)

  // ── Single actions ──

  const handleMove = async () => {
    if (!moveTarget || !moveDest) return
    try {
      await api.files.move(moveTarget, moveDest)
      setMoveTarget(null)
      loadDirectory(currentPath, true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const handleRename = async () => {
    if (!renameTarget || !renameValue) return
    try {
      await api.files.rename(renameTarget, renameValue)
      setRenameTarget(null)
      loadDirectory(currentPath, true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.files.delete(deleteTarget, !deletePermanent)
      setDeleteTarget(null)
      setDeletePermanent(false)
      loadDirectory(currentPath, true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  // ── Bulk actions ──

  const handleBulkMove = async () => {
    if (!bulkMoveDest || selected.size === 0) return
    try {
      await api.files.bulkMove([...selected], bulkMoveDest)
      setBulkMoveOpen(false)
      setBulkMoveDest('')
      loadDirectory(currentPath, true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    try {
      await api.files.bulkDelete([...selected], !bulkDeletePermanent)
      setBulkDeleteOpen(false)
      setBulkDeletePermanent(false)
      loadDirectory(currentPath, true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  // ── Open ──

  const handleOpen = (filePath: string) => api.files.open(filePath).catch(() => {})
  const handleOpenLocation = (filePath: string) => api.files.openLocation(filePath).catch(() => {})

  // ── Quick rule ──

  const openQuickRule = (ext: string) => {
    setRuleExt(ext)
    setRuleName(`Auto-manage ${ext} files`)
    setRuleAction('move')
    setRuleDest('')
    setRuleTrigger('file_created')
    setRuleCreated(false)
    setShowQuickRule(true)
  }

  const createQuickRule = async () => {
    try {
      await api.rules.create({
        name: ruleName,
        description: `Automatically ${ruleAction} ${ruleExt} files from ${currentPath}`,
        enabled: true, trigger: ruleTrigger, watchPaths: [currentPath],
        conditions: [{ field: 'extension', operator: 'equals', value: ruleExt }],
        actions: [{ type: ruleAction, destination: ruleDest || undefined }],
        priority: 100,
      })
      setRuleCreated(true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const breadcrumbs = currentPath.split('/').filter(Boolean)
  const maxSize = analysis ? Math.max(...analysis.breakdown.map(b => b.size), 1) : 1
  const dirSizeTotal = Object.values(dirSizes).reduce((sum, s) => sum + s, 0)
  const totalSize = (analysis?.totalSize ?? 0) + dirSizeTotal

  return (
    <div className={styles.page}>
      <DirectoryPicker value={currentPath} onChange={handlePickDirectory} placeholder="Choose a directory to analyze..." />

      {currentPath && (
        <div className={styles.breadcrumbs}>
          <button className={styles.crumb} onClick={() => navigateTo('/')}>~</button>
          {breadcrumbs.map((part, idx) => {
            const fullPath = '/' + breadcrumbs.slice(0, idx + 1).join('/')
            return (
              <span key={fullPath}>
                <span className={styles.separator}>/</span>
                <button className={styles.crumb} onClick={() => navigateTo(fullPath)}>{part}</button>
              </span>
            )
          })}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {loading && <Loader text="Scanning directory..." />}
      {!currentPath && !loading && <Loader text="Select a directory above to analyze its contents." />}

      {!loading && analysis && (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}><span className={styles.statValue}>{analysis.fileCount}</span><span className={styles.statLabel}>Files</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{analysis.dirCount}</span><span className={styles.statLabel}>Folders</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{humanSize(totalSize)}</span><span className={styles.statLabel}>Total Size</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{analysis.breakdown.length}</span><span className={styles.statLabel}>File Types</span></div>
          </div>

          <div className={styles.columns}>
            {/* Breakdown */}
            <div className={styles.breakdownPanel}>
              <div className={styles.breakdownHeader}>
                <span className={styles.breakdownTitle}>
                  File Types {deepScan && <Badge variant="primary">Deep</Badge>}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Badge variant="ghost">{analysis.breakdown.length}</Badge>
                  {!deepScan && !deepScanning && (
                    <button className={styles.breakdownRule} style={{ opacity: 1 }} onClick={handleDeepScan}>
                      Scan all subfolders
                    </button>
                  )}
                  {deepScanning && <Loader size="inline" text="Deep scanning..." />}
                </div>
              </div>
              <div className={styles.breakdownScroll}>
                {analysis.breakdown.length === 0 ? (
                  <Loader text="No files" />
                ) : (
                  <div className={styles.breakdown}>
                    {analysis.breakdown.map(item => (
                      <div key={item.extension} className={styles.breakdownRow}>
                        <span className={styles.breakdownExt}>{item.extension}</span>
                        <div className={styles.breakdownBarOuter}>
                          <div className={styles.breakdownBarInner} style={{ width: `${(item.size / maxSize) * 100}%` }} />
                        </div>
                        <span className={styles.breakdownCount}>{item.count} · {humanSize(item.size)}</span>
                        <button className={styles.breakdownRule} onClick={() => openQuickRule(item.extension)}>+ Rule</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Contents */}
            <div className={styles.contentsPanel}>
              <div className={styles.contentsHeader}>
                <span className={styles.contentsTitle}>Contents</span>
                {listing && <Badge variant="ghost">{listing.entries.length} items</Badge>}
              </div>

              {/* Sort bar */}
              <div className={styles.sortBar}>
                <span className={styles.sortLabel}>Sort:</span>
                {([['name', 'Name'], ['size', 'Size'], ['modified', 'Modified'], ['accessed', 'Accessed'], ['type', 'Type']] as const).map(([field, label]) => (
                  <button
                    key={field}
                    className={`${styles.sortBtn} ${sortField === field ? styles.sortBtnActive : ''}`}
                    onClick={() => handleSort(field)}
                  >
                    {label} {sortField === field ? (sortAsc ? '↑' : '↓') : ''}
                  </button>
                ))}
                {sizesLoading && (
                  <button className={styles.stopBtn} onClick={stopLoadingSizes}>
                    Stop loading sizes
                  </button>
                )}
                {!sizesLoading && Object.keys(dirSizes).length > 0 && (
                  <span className={styles.loadingIndicator}>Sizes loaded</span>
                )}
              </div>

              {/* Bulk action bar */}
              {selected.size > 0 && (
                <div className={styles.bulkBar}>
                  <span className={styles.bulkCount}>{selected.size} selected</span>
                  <button className={styles.selectAll} onClick={selectAll}>
                    {selected.size === (listing?.entries.length ?? 0) ? 'Deselect all' : 'Select all'}
                  </button>
                  <button className={styles.bulkBtn} onClick={() => { setBulkMoveDest(''); setBulkMoveOpen(true) }}>Move</button>
                  <button className={`${styles.bulkBtn} ${styles.bulkBtnDanger}`} onClick={() => setBulkDeleteOpen(true)}>Delete</button>
                  <button className={styles.bulkBtn} onClick={() => setSelected(new Set())}>Cancel</button>
                </div>
              )}

              <div className={styles.contentsScroll}>
                <div className={styles.fileList}>
                  {listing && listing.parent !== listing.path && (
                    <div className={`${styles.fileItem} ${styles.fileItemDir}`} onClick={() => navigateTo(listing.parent)}>
                      <div className={`${styles.fileIcon} ${styles.fileIconDir}`} style={{ fontSize: 16 }}>↑</div>
                      <div className={styles.fileInfo}><div className={styles.fileName}>..</div></div>
                    </div>
                  )}

                  {sortedEntries.map((entry, idx) => {
                    const isDir = entry.type === 'directory'
                    const isSelected = selected.has(entry.path)
                    return (
                      <div
                        key={entry.path}
                        className={[
                          styles.fileItem,
                          isDir ? styles.fileItemDir : '',
                          isSelected ? styles.fileItemSelected : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <button
                          className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ''}`}
                          onClick={e => { e.stopPropagation(); toggleSelect(entry.path, idx, e.shiftKey) }}
                        >
                          {isSelected ? '✓' : ''}
                        </button>

                        <div
                          className={`${styles.fileIcon} ${isDir ? styles.fileIconDir : styles.fileIconFile}`}
                          onClick={() => isDir && navigateTo(entry.path)}
                        >
                          <FileIcon name={entry.name} isDirectory={isDir} size={22} />
                        </div>
                        <div className={styles.fileInfo} onClick={() => isDir && navigateTo(entry.path)}>
                          <div className={styles.fileName}>{entry.name}</div>
                          <div className={styles.fileMeta}>
                            Modified {formatDate(entry.modified)} · Accessed {formatDate(entry.accessed)}
                            {entry.extension && <> · {entry.extension}</>}
                          </div>
                        </div>

                        <span className={styles.fileSize}>
                          {isDir
                            ? (dirSizes[entry.path] !== undefined ? humanSize(dirSizes[entry.path]) : '...')
                            : humanSize(entry.size)}
                        </span>

                        <div className={styles.fileActions} onClick={e => e.stopPropagation()}>
                          <button className={styles.actionBtn} title="Open" onClick={() => handleOpen(entry.path)}>⧉</button>
                          <button className={styles.actionBtn} title="Show in folder" onClick={() => handleOpenLocation(entry.path)}>📂</button>
                          <button className={styles.actionBtn} title="Move" onClick={() => { setMoveTarget(entry.path); setMoveDest('') }}>↗</button>
                          <button className={styles.actionBtn} title="Rename" onClick={() => { setRenameTarget(entry.path); setRenameValue(entry.name) }}>✎</button>
                          <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} title="Delete" onClick={() => setDeleteTarget(entry.path)}>×</button>
                        </div>
                      </div>
                    )
                  })}

                  {sortedEntries.length === 0 && !loading && <div className={styles.loading}>Empty directory</div>}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Single action modals ── */}
      <Modal open={moveTarget !== null} onClose={() => setMoveTarget(null)} title="Move File"
        footer={<><Button variant="ghost" onClick={() => setMoveTarget(null)}>Cancel</Button><Button onClick={handleMove} disabled={!moveDest}>Move</Button></>}>
        <div className={styles.moveForm}>
          <div className={styles.moveFrom}>{moveTarget}</div>
          <DirectoryPicker value={moveDest} onChange={setMoveDest} placeholder="Choose destination..." />
        </div>
      </Modal>

      <Modal open={renameTarget !== null} onClose={() => setRenameTarget(null)} title="Rename"
        footer={<><Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button><Button onClick={handleRename} disabled={!renameValue}>Rename</Button></>}>
        <Input label="New name" value={renameValue} onChange={e => setRenameValue(e.target.value)} />
      </Modal>

      <Modal open={deleteTarget !== null} onClose={() => { setDeleteTarget(null); setDeletePermanent(false) }} title="Delete"
        footer={<><Button variant="ghost" onClick={() => { setDeleteTarget(null); setDeletePermanent(false) }}>Cancel</Button><Button variant="danger" onClick={handleDelete}>{deletePermanent ? 'Permanently Delete' : 'Move to Trash'}</Button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: 'var(--mgr-text)', fontSize: 14 }}>
            Are you sure you want to delete <strong>{deleteTarget?.split('/').pop()}</strong>?
          </p>
          <div style={{ padding: '10px 12px', background: deletePermanent ? 'rgba(168,84,84,0.1)' : 'rgba(148,137,121,0.1)', borderRadius: 6, fontSize: 13, color: deletePermanent ? 'var(--mgr-danger)' : 'var(--mgr-text-muted)' }}>
            {deletePermanent
              ? '⚠ This will permanently delete the item. It cannot be recovered.'
              : 'This will send the item to the Recycle Bin where you can restore it later.'}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--mgr-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={deletePermanent} onChange={e => setDeletePermanent(e.target.checked)} />
            Delete permanently (bypass Recycle Bin)
          </label>
        </div>
      </Modal>

      {/* ── Bulk action modals ── */}
      <Modal open={bulkMoveOpen} onClose={() => setBulkMoveOpen(false)} title={`Move ${selected.size} items`}
        footer={<><Button variant="ghost" onClick={() => setBulkMoveOpen(false)}>Cancel</Button><Button onClick={handleBulkMove} disabled={!bulkMoveDest}>Move {selected.size} items</Button></>}>
        <div className={styles.moveForm}>
          <div className={styles.moveFrom}>{selected.size} files/folders selected</div>
          <DirectoryPicker value={bulkMoveDest} onChange={setBulkMoveDest} placeholder="Choose destination..." />
        </div>
      </Modal>

      <Modal open={bulkDeleteOpen} onClose={() => { setBulkDeleteOpen(false); setBulkDeletePermanent(false) }} title={`Delete ${selected.size} items`}
        footer={<><Button variant="ghost" onClick={() => { setBulkDeleteOpen(false); setBulkDeletePermanent(false) }}>Cancel</Button><Button variant="danger" onClick={handleBulkDelete}>{bulkDeletePermanent ? `Permanently Delete ${selected.size} items` : `Move ${selected.size} items to Trash`}</Button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: 'var(--mgr-text)', fontSize: 14 }}>
            Are you sure you want to delete <strong>{selected.size} items</strong>?
          </p>
          <div style={{ padding: '10px 12px', background: bulkDeletePermanent ? 'rgba(168,84,84,0.1)' : 'rgba(148,137,121,0.1)', borderRadius: 6, fontSize: 13, color: bulkDeletePermanent ? 'var(--mgr-danger)' : 'var(--mgr-text-muted)' }}>
            {bulkDeletePermanent
              ? '⚠ This will permanently delete all selected items. They cannot be recovered.'
              : 'This will send all selected items to the Recycle Bin where you can restore them later.'}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--mgr-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={bulkDeletePermanent} onChange={e => setBulkDeletePermanent(e.target.checked)} />
            Delete permanently (bypass Recycle Bin)
          </label>
        </div>
      </Modal>

      {/* ── Quick rule modal ── */}
      <Modal open={showQuickRule} onClose={() => setShowQuickRule(false)} title={`Create rule for ${ruleExt} files`}
        footer={ruleCreated
          ? <Button onClick={() => setShowQuickRule(false)}>Done</Button>
          : <><Button variant="ghost" onClick={() => setShowQuickRule(false)}>Cancel</Button><Button onClick={createQuickRule} disabled={!ruleName || (ruleAction !== 'delete' && !ruleDest)}>Create Rule</Button></>
        }>
        {ruleCreated ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Badge variant="success" dot>Rule created successfully</Badge>
            <p style={{ color: 'var(--mgr-text-muted)', marginTop: 12, fontSize: 14 }}>Go to the Rules page to manage it, or start the watcher to activate it.</p>
          </div>
        ) : (
          <div className={styles.quickRuleForm}>
            <Input label="Rule name" value={ruleName} onChange={e => setRuleName(e.target.value)} />
            <div className={styles.quickRuleRow}>
              <Select label="Trigger" options={TRIGGER_OPTIONS} value={ruleTrigger} onChange={e => setRuleTrigger(e.target.value)} />
              <Select label="Action" options={ACTION_TYPES} value={ruleAction} onChange={e => setRuleAction(e.target.value)} />
            </div>
            {ruleAction !== 'delete' && (
              <Input label="Destination" placeholder="/home/user/Documents/Organized" value={ruleDest} onChange={e => setRuleDest(e.target.value)} />
            )}
            <div style={{ fontSize: 13, color: 'var(--mgr-text-muted)' }}>
              Watching <strong style={{ color: 'var(--mgr-text)' }}>{currentPath}</strong> for <strong style={{ color: 'var(--mgr-text)' }}>{ruleExt}</strong> files
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
