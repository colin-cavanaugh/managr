import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type DirectoryAnalysis, type DirectoryListing } from '../api/client'
import { Badge, Button, DirectoryPicker, DriveIcon, FileIcon, Input, Loader, Modal, Select } from '../components'
import { getExtDescription } from '../data/extensionDescriptions'
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

interface ExplorerPageProps {
  onPathChange?: (path: string) => void
  externalNav?: string | null
  externalNavTrigger?: number
}

// Global session cache — persists across directory navigation until app closes
const globalSizeCache: Record<string, number> = {}

export function ExplorerPage({ onPathChange, externalNav, externalNavTrigger }: ExplorerPageProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [analysis, setAnalysis] = useState<DirectoryAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deepScan, setDeepScan] = useState(false)
  const [deepScanning, setDeepScanning] = useState(false)
  const [drives, setDrives] = useState<{ label: string; path: string; type: string }[]>([])
  const [selectedExt, setSelectedExt] = useState<string | null>(null)

  // Poll for drive changes every 5 seconds
  useEffect(() => {
    const fetchDrives = () => api.drives().then(setDrives).catch(() => {})
    fetchDrives()
    const interval = setInterval(fetchDrives, 5000)
    return () => clearInterval(interval)
  }, [])

  // Cache: path → { listing, analysis, dirSizes }
  const cache = useRef<Record<string, { listing: DirectoryListing; analysis: DirectoryAnalysis; dirSizes: Record<string, number> }>>({})

  // Lazy dir sizes with pause/resume
  const [dirSizes, setDirSizes] = useState<Record<string, number>>({})
  const [sizesLoading, setSizesLoading] = useState(false)
  const [sizesPaused, setSizesPaused] = useState(false)
  const sizeAbort = useRef<AbortController | null>(null)

  const pauseSizeLoading = () => {
    sizeAbort.current?.abort()
    setSizesPaused(true)
    setSizesLoading(false)
  }

  const resumeSizeLoading = useCallback(() => {
    if (!listing) return
    setSizesPaused(false)
    setSizesLoading(true)
    const controller = new AbortController()
    sizeAbort.current = controller
    const dirs = listing.entries.filter(e => e.type === 'directory')
    ;(async () => {
      for (const dir of dirs) {
        if (controller.signal.aborted) return
        // Skip already loaded (local state or global cache)
        if (dirSizes[dir.path] !== undefined) continue
        if (globalSizeCache[dir.path] !== undefined) {
          setDirSizes(prev => ({ ...prev, [dir.path]: globalSizeCache[dir.path] }))
          continue
        }
        try {
          const result = await api.files.size(dir.path)
          if (controller.signal.aborted) return
          globalSizeCache[dir.path] = result.size
          setDirSizes(prev => ({ ...prev, [dir.path]: result.size }))
        } catch { /* skip */ }
      }
      setSizesLoading(false)
    })()
  }, [listing, dirSizes])

  // Detect if path is a drive root where auto-scan would be too expensive
  function isDriveRoot(p: string): boolean {
    // Windows: C:\, D:\
    if (/^[A-Z]:\\?$/i.test(p)) return true
    // WSL: /mnt/c, /mnt/d
    if (/^\/mnt\/[a-z]\/?$/.test(p)) return true
    // Unix root
    if (p === '/') return true
    return false
  }

  useEffect(() => {
    if (!listing) return
    sizeAbort.current?.abort()
    const controller = new AbortController()
    sizeAbort.current = controller
    setSizesPaused(false)

    const dirs = listing.entries.filter(e => e.type === 'directory')
    if (dirs.length === 0) { setDirSizes({}); return }

    // Check global cache — populate immediately what we already know
    const cached: Record<string, number> = {}
    const uncached: typeof dirs = []
    for (const dir of dirs) {
      if (globalSizeCache[dir.path] !== undefined) {
        cached[dir.path] = globalSizeCache[dir.path]
      } else {
        uncached.push(dir)
      }
    }
    setDirSizes(cached)

    // If everything is already cached, we're done
    if (uncached.length === 0) {
      setSizesLoading(false)
      return
    }

    // Don't auto-scan at drive roots — require manual start
    if (isDriveRoot(currentPath)) {
      setSizesPaused(true)
      setSizesLoading(false)
      return
    }

    setSizesLoading(true)
    ;(async () => {
      for (const dir of uncached) {
        if (controller.signal.aborted) return
        try {
          const result = await api.files.size(dir.path)
          if (controller.signal.aborted) return
          // Store in global cache
          globalSizeCache[dir.path] = result.size
          setDirSizes(prev => ({ ...prev, [dir.path]: result.size }))
        } catch { /* skip */ }
      }
      setSizesLoading(false)
    })()
    return () => controller.abort()
  }, [listing])

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [deepSearch, setDeepSearch] = useState(false)
  const [searchResults, setSearchResults] = useState<import('../api/client').FileEntry[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (query: string) => {
    setSearchQuery(query)

    // Clear deep search results when query changes
    if (deepSearch) {
      setSearchResults(null)
      setSearching(false)
    }

    // Debounce deep search
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (deepSearch && query.length >= 2 && currentPath) {
      setSearching(true)
      searchTimeout.current = setTimeout(async () => {
        try {
          const result = await api.files.search(currentPath, query, true)
          setSearchResults(result.results)
        } catch { /* skip */ }
        setSearching(false)
      }, 400)
    }
  }

  const toggleDeepSearch = () => {
    const next = !deepSearch
    setDeepSearch(next)
    setSearchResults(null)
    if (next && searchQuery.length >= 2 && currentPath) {
      setSearching(true)
      api.files.search(currentPath, searchQuery, true).then(result => {
        setSearchResults(result.results)
        setSearching(false)
      }).catch(() => setSearching(false))
    }
  }

  // Sorting
  type SortField = 'name' | 'size' | 'modified' | 'accessed' | 'type'
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(field === 'name') }
  }

  // Use deep search results when active, otherwise filter local listing
  const baseEntries = (deepSearch && searchResults) ? searchResults : (listing?.entries ?? [])

  const filteredEntries = searchQuery && !deepSearch
    ? baseEntries.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : baseEntries

  const sortedEntries = [...filteredEntries].sort((a, b) => {
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
  })

  // Extension filter applied after sort
  const extFilteredEntries = selectedExt
    ? sortedEntries.filter(entry => {
        if (entry.type === 'file') return entry.extension === selectedExt
        // Directories: filter by folderExtensions when deep scan data is available,
        // otherwise hide all folders (we have no data on their contents)
        if (!deepScan || !analysis?.folderExtensions) return false
        return analysis.folderExtensions[entry.path]?.includes(selectedExt) ?? false
      })
    : sortedEntries

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedIdx = useRef<number | null>(null)

  // Ref to current visible (sorted) entries so shift-select uses the right order
  const visibleEntries = useRef<{ path: string }[]>([])
  visibleEntries.current = extFilteredEntries

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

  // Report path changes to parent
  useEffect(() => {
    onPathChange?.(currentPath)
  }, [currentPath, onPathChange])

  // Handle external navigation from sidebar
  useEffect(() => {
    if (externalNav && externalNavTrigger) {
      loadDirectory(externalNav)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalNavTrigger])

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

  // Extension description tooltip
  const [extTooltip, setExtTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

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
      setSearchQuery('')
      setSearchResults(null)
      setDeepSearch(false)
      setSelectedExt(null)
      return
    }

    setListing(null)
    setAnalysis(null)
    setSelected(new Set())
    lastClickedIdx.current = null
    setLoading(true)
    setError(null)
    setDeepScan(false)
    setSearchQuery('')
    setSearchResults(null)
    setDeepSearch(false)
    setSelectedExt(null)
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

  const deepScanAbort = useRef<AbortController | null>(null)

  const handleDeepScan = async () => {
    if (!currentPath) return
    // Stop volume loading — deep scan will cover it
    sizeAbort.current?.abort()
    setSizesLoading(false)
    setSizesPaused(false)

    deepScanAbort.current?.abort()
    const controller = new AbortController()
    deepScanAbort.current = controller
    setDeepScanning(true)
    try {
      const result = await api.files.analyze(currentPath, true)
      if (controller.signal.aborted) return
      setAnalysis(result)
      setDeepScan(true)
      // Populate ALL folder sizes into global cache + local state
      if (result.folderSizes) {
        // Store every folder size in the global session cache
        Object.assign(globalSizeCache, result.folderSizes)
        // Set sizes for current directory's immediate children
        const currentDirSizes: Record<string, number> = {}
        if (listing) {
          for (const entry of listing.entries) {
            if (entry.type === 'directory' && result.folderSizes[entry.path] !== undefined) {
              currentDirSizes[entry.path] = result.folderSizes[entry.path]
            }
          }
        }
        setDirSizes(prev => ({ ...prev, ...currentDirSizes }))
        setSizesLoading(false)
        setSizesPaused(false)
        sizeAbort.current?.abort()
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setDeepScanning(false)
    }
  }

  const [skippedDirs, setSkippedDirs] = useState<Set<string>>(new Set())

  // Load skip list on mount
  useEffect(() => {
    api.dirs.skipped().then(list => setSkippedDirs(new Set(list))).catch(() => {})
  }, [])

  const handleSkipDir = async (dirPath: string) => {
    await api.dirs.skip(dirPath)
    setSkippedDirs(prev => new Set([...prev, dirPath]))
    setDirSizes(prev => { const next = { ...prev }; delete next[dirPath]; return next })
  }

  const handleUnskipDir = async (dirPath: string) => {
    await api.dirs.unskip(dirPath)
    setSkippedDirs(prev => { const next = new Set(prev); next.delete(dirPath); return next })
  }

  const stopDeepScan = () => {
    deepScanAbort.current?.abort()
    setDeepScanning(false)
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
      {/* Drives */}
      {drives.length > 0 && (
        <div className={styles.drivesBar}>
          {drives.map(d => {
            const isActive = currentPath.startsWith(d.path)
            return (
              <button
                key={d.path}
                className={`${styles.driveBtn} ${isActive ? styles.driveBtnActive : ''}`}
                onClick={() => loadDirectory(d.path)}
                title={d.path}
              >
                <DriveIcon driveType={d.type as 'drive' | 'mount' | 'home'} label={d.label} size={16} />
                {d.label}
              </button>
            )
          })}
        </div>
      )}

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
                  {deepScanning && (
                    <>
                      <Loader size="inline" text="Deep scanning..." />
                      <button className={styles.stopBtn} onClick={stopDeepScan}>Stop</button>
                    </>
                  )}
                </div>
              </div>
              <div className={styles.breakdownScroll}>
                {analysis.breakdown.length === 0 ? (
                  <Loader text="No files" />
                ) : (
                  <div className={styles.breakdown}>
                    {analysis.breakdown.map(item => {
                      const desc = getExtDescription(item.extension)
                      const isSelected = selectedExt === item.extension
                      return (
                        <div
                          key={item.extension}
                          className={[styles.breakdownRow, isSelected ? styles.breakdownRowSelected : ''].filter(Boolean).join(' ')}
                          onClick={() => setSelectedExt(prev => prev === item.extension ? null : item.extension)}
                          onMouseEnter={desc ? e => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            setExtTooltip({ text: desc, x: rect.right + 10, y: rect.top + rect.height / 2 })
                          } : undefined}
                          onMouseLeave={desc ? () => setExtTooltip(null) : undefined}
                        >
                          <span className={`${styles.breakdownExt} ${desc ? styles.breakdownExtKnown : ''}`}>{item.extension}</span>
                          <div className={styles.breakdownBarOuter}>
                            <div className={styles.breakdownBarInner} style={{ width: `${(item.size / maxSize) * 100}%` }} />
                          </div>
                          <span className={styles.breakdownCount}>{item.count} · {humanSize(item.size)}</span>
                          <button className={styles.breakdownRule} onClick={e => { e.stopPropagation(); openQuickRule(item.extension) }}>+ Rule</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Contents */}
            <div className={styles.contentsPanel}>
              <div className={styles.contentsHeader}>
                <span className={styles.contentsTitle}>Contents</span>
                {listing && <Badge variant="ghost">
                  {(searchQuery || selectedExt)
                    ? `${extFilteredEntries.length} of ${listing.entries.length}`
                    : `${listing.entries.length} items`}
                </Badge>}
                {selectedExt && (
                  <button className={styles.extFilterPill} onClick={() => setSelectedExt(null)}>
                    {selectedExt} ×
                  </button>
                )}
              </div>
              {selectedExt && !deepScan && (
                <div className={styles.extFilterHint}>
                  Folders hidden — <button className={styles.extFilterHintBtn} onClick={handleDeepScan}>Deep Scan</button> to filter them too
                </div>
              )}

              {/* Search bar */}
              <div className={styles.searchBar}>
                <input
                  className={styles.searchInput}
                  type="text"
                  placeholder={deepSearch ? 'Search all subfolders...' : 'Filter by name...'}
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                />
                <button
                  className={`${styles.searchToggle} ${deepSearch ? styles.searchToggleActive : ''}`}
                  onClick={toggleDeepSearch}
                  title="Search all subfolders recursively"
                >
                  {deepSearch ? 'Deep search ON' : 'Deep search'}
                </button>
                {searching && <Loader size="inline" text="" />}
                {searchQuery && !searching && (
                  <span className={styles.searchCount}>{extFilteredEntries.length} found</span>
                )}
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
                {sizesLoading && !deepScanning && (
                  <button className={styles.stopBtn} onClick={pauseSizeLoading}>
                    Pause Volume
                  </button>
                )}
                {deepScanning && (
                  <button className={styles.stopBtn} onClick={stopDeepScan}>
                    Stop Deep Scan
                  </button>
                )}
                {sizesPaused && !deepScanning && (
                  <button className={styles.sortBtnActive + ' ' + styles.sortBtn} onClick={resumeSizeLoading} style={{ marginLeft: 'auto', borderColor: 'var(--mgr-primary)', color: 'var(--mgr-primary)' }}>
                    {Object.keys(dirSizes).length === 0
                      ? 'Calculate Volume'
                      : `Resume (${Object.keys(dirSizes).length}/${listing?.entries.filter(e => e.type === 'directory').length ?? 0})`}
                  </button>
                )}
                {!sizesLoading && !sizesPaused && !deepScanning && Object.keys(dirSizes).length > 0 && (
                  <span className={styles.diskSpaceDone}>
                    ✓ Volume
                  </span>
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
                    <div className={`${styles.fileItem} ${styles.fileItemDir} ${styles.upLevel}`} onClick={() => navigateTo(listing.parent)}>
                      <div className={`${styles.fileIcon} ${styles.fileIconDir}`} style={{ fontSize: 16 }}>↑</div>
                      <div className={styles.fileInfo}><div className={styles.fileName}>..</div></div>
                    </div>
                  )}

                  {extFilteredEntries.map((entry, idx) => {
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
                            ? (skippedDirs.has(entry.path)
                              ? <span style={{ color: 'var(--mgr-danger)', fontSize: 10 }}>skipped</span>
                              : dirSizes[entry.path] !== undefined ? humanSize(dirSizes[entry.path]) : '...')
                            : humanSize(entry.size)}
                        </span>

                        <div className={styles.fileActions} onClick={e => e.stopPropagation()}>
                          <button className={styles.actionBtn} title="Open" onClick={() => handleOpen(entry.path)}>⧉</button>
                          <button className={styles.actionBtn} title="Show in folder" onClick={() => handleOpenLocation(entry.path)}>📂</button>
                          {isDir && (
                            skippedDirs.has(entry.path)
                              ? <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} title="Unskip — include in scans" onClick={() => handleUnskipDir(entry.path)} style={{ opacity: 1 }}>⊘</button>
                              : <button className={styles.actionBtn} title="Skip in scans" onClick={() => handleSkipDir(entry.path)}>⊘</button>
                          )}
                          <button className={styles.actionBtn} title="Move" onClick={() => { setMoveTarget(entry.path); setMoveDest('') }}>↗</button>
                          <button className={styles.actionBtn} title="Rename" onClick={() => { setRenameTarget(entry.path); setRenameValue(entry.name) }}>✎</button>
                          <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} title="Delete" onClick={() => setDeleteTarget(entry.path)}>×</button>
                        </div>
                      </div>
                    )
                  })}

                  {extFilteredEntries.length === 0 && !loading && (
                    <div className={styles.loading}>
                      {selectedExt
                        ? deepScan
                          ? `No ${selectedExt} files or folders containing them here`
                          : `No ${selectedExt} files directly in this folder`
                        : 'Empty directory'}
                    </div>
                  )}
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

      {extTooltip && (
        <div
          className={styles.extTooltip}
          style={{ left: extTooltip.x, top: extTooltip.y }}
        >
          {extTooltip.text}
        </div>
      )}
    </div>
  )
}
