/**
 * managr — API client
 *
 * Thin wrapper around fetch for the Express API.
 * All endpoints are proxied through Vite in dev.
 */

// In Electron production mode, the app loads from file:// so we need the full URL.
// In dev mode (Vite), the proxy handles /api → localhost:3456.
const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:'
const BASE = isFileProtocol ? 'http://localhost:3456/api' : '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`)
  return data as T
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Rule {
  id: string
  name: string
  description?: string
  enabled: boolean
  trigger: string
  watchPaths: string[]
  conditions: RuleCondition[]
  actions: RuleAction[]
  priority: number
  createdAt: string
  updatedAt: string
}

export interface RuleCondition {
  field: string
  operator: string
  value: string | number
}

export interface RuleAction {
  type: string
  destination?: string
  pattern?: string
  trash?: boolean
}

export interface ActivityEntry {
  id: string
  ruleId: string | null
  ruleName: string | null
  action: string
  sourcePath: string
  destPath: string | null
  status: 'success' | 'error' | 'rolled_back'
  error?: string
  snapshotId: string | null
  timestamp: string
}

export interface SnapshotBatch {
  batchId: string
  fileCount: number
  action: string
  createdAt: string
}

export interface SnapshotFile {
  id: string
  batchId: string
  originalPath: string
  newPath: string | null
  action: string
  rolledBack: boolean
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modified: string
  accessed: string
  extension: string
}

export interface DirectoryListing {
  path: string
  parent: string
  entries: FileEntry[]
}

export interface DirectoryAnalysis {
  path: string
  fileCount: number
  dirCount: number
  totalSize: number
  breakdown: { extension: string; count: number; size: number }[]
  folderSizes?: Record<string, number>
  folderExtensions?: Record<string, string[]>
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export interface PlatformInfo {
  os: 'windows' | 'mac' | 'linux' | 'wsl'
  linuxHome: string
  windowsHome: string | null
  defaultHome: string
}

export const api = {
  platform: () => request<PlatformInfo>('/platform'),

  drives: () => request<{ label: string; path: string; type: 'drive' | 'mount' | 'home' }[]>('/drives'),

  rules: {
    list: (enabledOnly = false) =>
      request<{ count: number; rules: Rule[] }>(`/rules${enabledOnly ? '?enabledOnly=true' : ''}`),

    get: (id: string) =>
      request<Rule>(`/rules/${id}`),

    create: (rule: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>) =>
      request<Rule>('/rules', { method: 'POST', body: JSON.stringify(rule) }),

    update: (id: string, updates: Partial<Rule>) =>
      request<Rule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),

    delete: (id: string) =>
      request<{ status: string }>(`/rules/${id}`, { method: 'DELETE' }),

    run: (id: string) =>
      request<{ processed: number; errors: number }>(`/rules/${id}/run`, { method: 'POST' }),
  },

  activity: {
    list: (limit = 50, offset = 0, ruleId?: string) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (ruleId) params.set('ruleId', ruleId)
      return request<{ count: number; entries: ActivityEntry[] }>(`/activity?${params}`)
    },
  },

  snapshots: {
    list: (limit = 20) =>
      request<{ count: number; batches: SnapshotBatch[] }>(`/snapshots?limit=${limit}`),

    getFiles: (batchId: string) =>
      request<{ batchId: string; files: SnapshotFile[] }>(`/snapshots/${batchId}`),

    rollback: (batchId: string) =>
      request<{ restored: number; errors: string[] }>(`/snapshots/${batchId}/rollback`, { method: 'POST' }),
  },

  watcher: {
    status: () =>
      request<{ running: boolean; watchedPaths: string[] }>('/watcher/status'),

    start: () =>
      request<{ status: string }>('/watcher/start', { method: 'POST' }),

    stop: () =>
      request<{ status: string }>('/watcher/stop', { method: 'POST' }),
  },

  dirs: {
    frequent: () =>
      request<{ path: string; visitCount: number; lastVisited: string }[]>('/dirs/frequent'),

    pinned: () =>
      request<{ id: string; path: string; label: string }[]>('/dirs/pinned'),

    pin: (dirPath: string, label?: string) =>
      request<{ id: string; path: string; label: string }>('/dirs/pin', { method: 'POST', body: JSON.stringify({ path: dirPath, label }) }),

    unpin: (dirPath: string) =>
      request<{ status: string }>('/dirs/pin', { method: 'DELETE', body: JSON.stringify({ path: dirPath }) }),

    skipped: () =>
      request<string[]>('/dirs/skipped'),

    skip: (dirPath: string) =>
      request<{ status: string }>('/dirs/skip', { method: 'POST', body: JSON.stringify({ path: dirPath }) }),

    unskip: (dirPath: string) =>
      request<{ status: string }>('/dirs/skip', { method: 'DELETE', body: JSON.stringify({ path: dirPath }) }),
  },

  files: {
    list: (dirPath?: string) => {
      const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''
      return request<DirectoryListing>(`/files/list${params}`)
    },

    analyze: (dirPath: string, deep = false) => {
      const url = `/files/analyze?path=${encodeURIComponent(dirPath)}${deep ? '&deep=true' : ''}`
      // Deep scans can take minutes on large directories
      if (deep) {
        return fetch(`${BASE}${url}`, {
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(300000), // 5 min
        }).then(async res => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`)
          return data as DirectoryAnalysis
        })
      }
      return request<DirectoryAnalysis>(url)
    },

    size: (dirPath: string) =>
      request<{ path: string; size: number }>(`/files/size?path=${encodeURIComponent(dirPath)}`),

    duplicates: (dirPath: string) =>
      request<{ path: string; groupCount: number; groups: string[][] }>(`/files/duplicates?path=${encodeURIComponent(dirPath)}`),

    move: (sourcePath: string, destDir: string) =>
      request<{ status: string; from: string; to: string }>('/files/move', { method: 'POST', body: JSON.stringify({ sourcePath, destDir }) }),

    rename: (filePath: string, newName: string) =>
      request<{ status: string; from: string; to: string }>('/files/rename', { method: 'POST', body: JSON.stringify({ filePath, newName }) }),

    delete: (filePath: string, useTrash = true) =>
      request<{ status: string; path: string }>('/files/delete', { method: 'POST', body: JSON.stringify({ filePath, useTrash }) }),

    open: (filePath: string) =>
      request<{ status: string }>('/files/open', { method: 'POST', body: JSON.stringify({ filePath }) }),

    openLocation: (filePath: string) =>
      request<{ status: string }>('/files/open-location', { method: 'POST', body: JSON.stringify({ filePath }) }),

    bulkMove: (paths: string[], destDir: string) =>
      request<{ moved: number; errors: string[] }>('/files/bulk-move', { method: 'POST', body: JSON.stringify({ paths, destDir }) }),

    bulkDelete: (paths: string[], useTrash = true) =>
      request<{ deleted: number; errors: string[] }>('/files/bulk-delete', { method: 'POST', body: JSON.stringify({ paths, useTrash }) }),

    search: (dirPath: string, query: string, deep = false, limit = 200) =>
      request<{ path: string; query: string; deep: boolean; count: number; results: FileEntry[] }>(
        `/files/search?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(query)}&deep=${deep}&limit=${limit}`
      ),
  },
}
