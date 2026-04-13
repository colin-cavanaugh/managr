/**
 * managr — HTTP API server
 *
 * REST endpoints for the React dashboard. Shares the same SQLite
 * database and rules engine as the MCP server.
 */

import express from 'express'
import cors from 'cors'
import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import * as path from 'path'
import * as os from 'os'
import { exec } from 'child_process'
import { ManagrDB } from './database.js'
import { RulesEngine } from './engine.js'
import type { RuleCondition, RuleAction, TriggerType, ActionType } from './types.js'

const DB_PATH = path.join(os.homedir(), '.managr', 'managr.db')
const db = new ManagrDB(DB_PATH)
const engine = new RulesEngine(db)

const app = express()
app.use(cors())
app.use(express.json())

// ─── Platform detection ─────────────────────────────────────────────────────

interface PlatformInfo {
  os: 'windows' | 'mac' | 'linux' | 'wsl'
  linuxHome: string
  windowsHome: string | null
  defaultHome: string
}

async function detectPlatform(): Promise<PlatformInfo> {
  const linuxHome = os.homedir()
  const platform = os.platform()

  // Detect WSL
  try {
    const version = await fs.readFile('/proc/version', 'utf-8')
    if (version.toLowerCase().includes('microsoft')) {
      // Find the Windows user directory
      const usersDir = '/mnt/c/Users'
      try {
        const users = await fs.readdir(usersDir)
        const skip = new Set(['All Users', 'Default', 'Default User', 'Public', 'desktop.ini'])
        const winUser = users.find(u => !skip.has(u))
        const windowsHome = winUser ? path.join(usersDir, winUser) : null
        return { os: 'wsl', linuxHome, windowsHome, defaultHome: windowsHome || linuxHome }
      } catch {
        return { os: 'wsl', linuxHome, windowsHome: null, defaultHome: linuxHome }
      }
    }
  } catch {
    // Not WSL
  }

  if (platform === 'darwin') {
    return { os: 'mac', linuxHome, windowsHome: null, defaultHome: linuxHome }
  }
  if (platform === 'win32') {
    return { os: 'windows', linuxHome, windowsHome: linuxHome, defaultHome: linuxHome }
  }
  return { os: 'linux', linuxHome, windowsHome: null, defaultHome: linuxHome }
}

let platformCache: PlatformInfo | null = null

async function getPlatform(): Promise<PlatformInfo> {
  if (!platformCache) platformCache = await detectPlatform()
  return platformCache
}

app.get('/api/platform', async (_req, res) => {
  const info = await getPlatform()
  res.json(info)
})

app.get('/api/drives', async (_req, res) => {
  const platform = await getPlatform()
  const drives: { label: string; path: string; type: 'drive' | 'mount' | 'home' }[] = []

  if (os.platform() === 'win32') {
    // Native Windows — check drive letters A-Z
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code)
      const drivePath = `${letter}:\\`
      try {
        await fs.access(drivePath)
        drives.push({ label: `${letter}:`, path: drivePath, type: 'drive' })
      } catch { /* not available */ }
    }
  } else if (platform.os === 'wsl') {
    // WSL — list mounted Windows drives + Linux home
    drives.push({ label: 'Linux Home', path: platform.linuxHome, type: 'home' })
    try {
      const mounts = await fs.readdir('/mnt')
      for (const m of mounts) {
        if (m.length === 1 && /[a-z]/.test(m)) {
          const mountPath = `/mnt/${m}`
          try {
            await fs.access(mountPath)
            drives.push({ label: `${m.toUpperCase()}: Drive`, path: mountPath, type: 'drive' })
          } catch { /* skip */ }
        }
      }
    } catch { /* no /mnt */ }
    if (platform.windowsHome) {
      drives.push({ label: 'Windows Home', path: platform.windowsHome, type: 'home' })
    }
  } else {
    // Mac/Linux — show home and root
    drives.push({ label: 'Home', path: os.homedir(), type: 'home' })
    drives.push({ label: '/', path: '/', type: 'mount' })
  }

  res.json(drives)
})

// ─── Rules ──────────────────────────────────────────────────────────────────

app.get('/api/rules', (_req, res) => {
  const enabledOnly = _req.query.enabledOnly === 'true'
  const rules = db.listRules(enabledOnly)
  res.json({ count: rules.length, rules })
})

app.get('/api/rules/:id', (req, res) => {
  const rule = db.getRule(req.params.id)
  if (!rule) return res.status(404).json({ error: 'Rule not found' })
  res.json(rule)
})

app.post('/api/rules', (req, res) => {
  const { name, description, trigger, watchPaths, conditions, actions, priority, enabled } = req.body
  const rule = db.createRule({
    name,
    description,
    enabled: enabled ?? true,
    trigger: trigger as TriggerType,
    watchPaths,
    conditions: conditions as RuleCondition[],
    actions: actions as RuleAction[],
    priority: priority ?? 100,
  })
  engine.refresh()
  res.status(201).json(rule)
})

app.put('/api/rules/:id', (req, res) => {
  const rule = db.updateRule(req.params.id, req.body)
  if (!rule) return res.status(404).json({ error: 'Rule not found' })
  engine.refresh()
  res.json(rule)
})

app.delete('/api/rules/:id', (req, res) => {
  const deleted = db.deleteRule(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Rule not found' })
  engine.refresh()
  res.json({ status: 'deleted' })
})

app.post('/api/rules/:id/run', async (req, res) => {
  try {
    const result = await engine.runRule(req.params.id)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ─── Activity ───────────────────────────────────────────────────────────────

app.get('/api/activity', (req, res) => {
  const limit = Number(req.query.limit) || 50
  const offset = Number(req.query.offset) || 0
  const ruleId = req.query.ruleId as string | undefined

  const entries = ruleId
    ? db.getActivityByRule(ruleId, limit)
    : db.getActivityLog(limit, offset)

  res.json({ count: entries.length, entries })
})

// ─── Snapshots ──────────────────────────────────────────────────────────────

app.get('/api/snapshots', (req, res) => {
  const limit = Number(req.query.limit) || 20
  const batches = db.getRecentSnapshots(limit)
  res.json({ count: batches.length, batches })
})

app.get('/api/snapshots/:batchId', (req, res) => {
  const files = db.getSnapshotsByBatch(req.params.batchId)
  res.json({ batchId: req.params.batchId, files })
})

app.post('/api/snapshots/:batchId/rollback', async (req, res) => {
  try {
    const result = await engine.rollback(req.params.batchId)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ─── Watcher ────────────────────────────────────────────────────────────────

app.get('/api/watcher/status', (_req, res) => {
  const watcher = engine['watcher']
  res.json({ running: watcher.isRunning(), watchedPaths: watcher.watchedPaths() })
})

app.post('/api/watcher/start', (_req, res) => {
  engine.start()
  res.json({ status: 'started' })
})

app.post('/api/watcher/stop', async (_req, res) => {
  await engine.stop()
  res.json({ status: 'stopped' })
})

// ─── File Explorer ──────────────────────────────────────────────────────────

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modified: string
  accessed: string
  extension: string
}

/** Recursively calculate total size of a directory. */
async function dirSize(dirPath: string, maxDepth = 10, depth = 0): Promise<number> {
  if (depth > maxDepth) return 0
  let total = 0
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      try {
        if (entry.isFile()) {
          const stat = await fs.stat(fullPath)
          total += stat.size
        } else if (entry.isDirectory()) {
          total += await dirSize(fullPath, maxDepth, depth + 1)
        }
      } catch {
        // skip inaccessible
      }
    }
  } catch {
    // skip
  }
  return total
}

app.get('/api/files/list', async (req, res) => {
  const platform = await getPlatform()
  const dirPath = (req.query.path as string) || platform.defaultHome

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files: FileEntry[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dirPath, entry.name)
      try {
        const stat = await fs.stat(fullPath)
        files.push({
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? stat.size : 0,
          modified: stat.mtime.toISOString(),
          accessed: stat.atime.toISOString(),
          extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        })
      } catch {
        // skip inaccessible entries
      }
    }

    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    // Auto-track visit for frequent dirs
    db.recordVisit(dirPath)

    res.json({ path: dirPath, parent: path.dirname(dirPath), entries: files })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/files/size', async (req, res) => {
  const dirPath = req.query.path as string
  if (!dirPath) return res.status(400).json({ error: 'path is required' })
  try {
    const size = await dirSize(dirPath)
    res.json({ path: dirPath, size })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/files/analyze', async (req, res) => {
  const dirPath = req.query.path as string
  const deep = req.query.deep === 'true'
  if (!dirPath) return res.status(400).json({ error: 'path is required' })

  try {
    let totalSize = 0
    let fileCount = 0
    let dirCount = 0
    const byExtension: Record<string, { count: number; size: number }> = {}

    async function scan(dir: string, depth = 0): Promise<void> {
      if (!deep && depth > 0) return
      if (depth > 10) return
      let entries
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)
        try {
          if (entry.isDirectory()) {
            if (depth === 0) dirCount++
            if (deep) await scan(fullPath, depth + 1)
          } else if (entry.isFile()) {
            const stat = await fs.stat(fullPath)
            fileCount++
            totalSize += stat.size
            const ext = path.extname(entry.name).toLowerCase() || '(none)'
            if (!byExtension[ext]) byExtension[ext] = { count: 0, size: 0 }
            byExtension[ext].count++
            byExtension[ext].size += stat.size
          }
        } catch { /* skip */ }
      }
    }

    await scan(dirPath)

    const breakdown = Object.entries(byExtension)
      .map(([ext, data]) => ({ extension: ext, ...data }))
      .sort((a, b) => b.size - a.size)

    res.json({ path: dirPath, deep, fileCount, dirCount, totalSize, breakdown })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/files/duplicates', async (req, res) => {
  const dirPath = req.query.path as string
  if (!dirPath) return res.status(400).json({ error: 'path is required' })

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const hashes: Record<string, string[]> = {}

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const fullPath = path.join(dirPath, entry.name)
      try {
        const content = await fs.readFile(fullPath)
        const hash = crypto.createHash('md5').update(content).digest('hex')
        if (!hashes[hash]) hashes[hash] = []
        hashes[hash].push(fullPath)
      } catch {
        // skip
      }
    }

    const duplicates = Object.values(hashes).filter(group => group.length > 1)
    res.json({ path: dirPath, groupCount: duplicates.length, groups: duplicates })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ─── Frequent & Pinned Dirs ─────────────────────────────────────────────────

app.post('/api/dirs/visit', (req, res) => {
  const { path: dirPath } = req.body as { path: string }
  if (!dirPath) return res.status(400).json({ error: 'path is required' })
  db.recordVisit(dirPath)
  res.json({ status: 'recorded' })
})

app.get('/api/dirs/frequent', (_req, res) => {
  res.json(db.getFrequentDirs(4))
})

app.get('/api/dirs/pinned', (_req, res) => {
  res.json(db.getPinnedDirs())
})

app.post('/api/dirs/pin', (req, res) => {
  const { path: dirPath, label } = req.body as { path: string; label: string }
  if (!dirPath) return res.status(400).json({ error: 'path is required' })
  const pin = db.pinDir(dirPath, label || dirPath.split(/[\\/]/).pop() || dirPath)
  res.json(pin)
})

app.delete('/api/dirs/pin', (req, res) => {
  const { path: dirPath } = req.body as { path: string }
  if (!dirPath) return res.status(400).json({ error: 'path is required' })
  db.unpinDir(dirPath)
  res.json({ status: 'unpinned' })
})

// ─── Search ─────────────────────────────────────────────────────────────────

app.get('/api/files/search', async (req, res) => {
  const dirPath = req.query.path as string
  const query = (req.query.q as string || '').toLowerCase()
  const deep = req.query.deep === 'true'
  const maxResults = Number(req.query.limit) || 200

  if (!dirPath || !query) return res.status(400).json({ error: 'path and q are required' })

  try {
    const results: { name: string; path: string; type: 'file' | 'directory'; size: number; modified: string; extension: string }[] = []

    async function search(dir: string, depth = 0): Promise<void> {
      if (results.length >= maxResults) return
      if (depth > 10) return
      let entries
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }

      for (const entry of entries) {
        if (results.length >= maxResults) return
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)

        if (entry.name.toLowerCase().includes(query)) {
          try {
            const stat = await fs.stat(fullPath)
            results.push({
              name: entry.name,
              path: fullPath,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: entry.isFile() ? stat.size : 0,
              modified: stat.mtime.toISOString(),
              extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
            })
          } catch { /* skip */ }
        }

        if (deep && entry.isDirectory()) {
          await search(fullPath, depth + 1)
        }
      }
    }

    await search(dirPath)
    res.json({ path: dirPath, query, deep, count: results.length, results })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ─── File Operations (with activity logging) ───────────────────────────────

function logAction(action: string, sourcePath: string, destPath: string | null, status: 'success' | 'error', error?: string) {
  db.logActivity({
    ruleId: null,
    ruleName: 'Explorer',
    action: action as ActionType,
    sourcePath,
    destPath,
    status,
    error,
    snapshotId: null,
  })
}

app.post('/api/files/move', async (req, res) => {
  const { sourcePath, destDir } = req.body as { sourcePath: string; destDir: string }
  if (!sourcePath || !destDir) return res.status(400).json({ error: 'sourcePath and destDir are required' })
  try {
    await fs.mkdir(destDir, { recursive: true })
    const destPath = path.join(destDir, path.basename(sourcePath))
    await fs.rename(sourcePath, destPath)
    logAction('move', sourcePath, destPath, 'success')
    res.json({ status: 'moved', from: sourcePath, to: destPath })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logAction('move', sourcePath, null, 'error', msg)
    res.status(400).json({ error: msg })
  }
})

app.post('/api/files/rename', async (req, res) => {
  const { filePath, newName } = req.body as { filePath: string; newName: string }
  if (!filePath || !newName) return res.status(400).json({ error: 'filePath and newName are required' })
  if (newName.includes('/') || newName.includes('\\')) return res.status(400).json({ error: 'newName must not contain path separators' })
  try {
    const newPath = path.join(path.dirname(filePath), newName)
    await fs.rename(filePath, newPath)
    logAction('rename', filePath, newPath, 'success')
    res.json({ status: 'renamed', from: filePath, to: newPath })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logAction('rename', filePath, null, 'error', msg)
    res.status(400).json({ error: msg })
  }
})

async function trashFile(filePath: string): Promise<void> {
  // Dynamic import because trash is ESM-only
  const { default: trash } = await import('trash')
  await trash(filePath)
}

app.post('/api/files/delete', async (req, res) => {
  const { filePath, useTrash } = req.body as { filePath: string; useTrash?: boolean }
  if (!filePath) return res.status(400).json({ error: 'filePath is required' })
  try {
    const method = useTrash !== false ? 'trash' : 'permanent'
    if (useTrash !== false) {
      // Default: send to recycle bin / trash
      try {
        await trashFile(filePath)
      } catch {
        // Fallback to permanent delete if trash fails (e.g. WSL without trash support)
        const stat = await fs.stat(filePath)
        if (stat.isDirectory()) await fs.rm(filePath, { recursive: true })
        else await fs.unlink(filePath)
      }
    } else {
      // Explicit permanent delete
      const stat = await fs.stat(filePath)
      if (stat.isDirectory()) await fs.rm(filePath, { recursive: true })
      else await fs.unlink(filePath)
    }
    logAction('delete', filePath, null, 'success')
    res.json({ status: 'deleted', method, path: filePath })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logAction('delete', filePath, null, 'error', msg)
    res.status(400).json({ error: msg })
  }
})

// ─── Open file / location ───────────────────────────────────────────────────

function shellOpen(target: string): Promise<void> {
  return new Promise((resolve) => {
    const platform = os.platform()

    // Convert WSL path to Windows path for explorer
    const toWinPath = (p: string) => p.startsWith('/mnt/') ? p.replace(/^\/mnt\/([a-z])/, '$1:').replace(/\//g, '\\') : p

    if (platform === 'win32') {
      // Native Windows — use explorer.exe directly (works for both files and folders)
      exec(`explorer "${target}"`, () => resolve())
    } else if (process.env.WSL_DISTRO_NAME || require('fs').existsSync('/proc/version')) {
      // WSL — convert path and use explorer.exe
      const winPath = toWinPath(target)
      exec(`explorer.exe "${winPath}"`, () => resolve())
    } else if (platform === 'darwin') {
      exec(`open "${target}"`, () => resolve())
    } else {
      exec(`xdg-open "${target}"`, () => resolve())
    }
  })
}

app.post('/api/files/open', async (req, res) => {
  const { filePath } = req.body as { filePath: string }
  if (!filePath) return res.status(400).json({ error: 'filePath is required' })
  try {
    await fs.access(filePath)
    await shellOpen(filePath)
    res.json({ status: 'opened', path: filePath })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/files/open-location', async (req, res) => {
  const { filePath } = req.body as { filePath: string }
  if (!filePath) return res.status(400).json({ error: 'filePath is required' })
  try {
    const isDir = (await fs.stat(filePath)).isDirectory()
    if (os.platform() === 'win32' && !isDir) {
      // On Windows, highlight the file in Explorer
      exec(`explorer /select,"${filePath}"`, () => {})
      res.json({ status: 'opened', path: filePath })
    } else {
      const dir = isDir ? filePath : path.dirname(filePath)
      await shellOpen(dir)
      res.json({ status: 'opened', path: dir })
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ─── Bulk Operations ────────────────────────────────────────────────────────

app.post('/api/files/bulk-move', async (req, res) => {
  const { paths, destDir } = req.body as { paths: string[]; destDir: string }
  if (!paths?.length || !destDir) return res.status(400).json({ error: 'paths and destDir are required' })
  try {
    await fs.mkdir(destDir, { recursive: true })
    const results: { from: string; to: string }[] = []
    const errors: string[] = []
    for (const p of paths) {
      try {
        const dest = path.join(destDir, path.basename(p))
        await fs.rename(p, dest)
        logAction('move', p, dest, 'success')
        results.push({ from: p, to: dest })
      } catch (err) {
        const msg = `${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`
        logAction('move', p, null, 'error', msg)
        errors.push(msg)
      }
    }
    res.json({ moved: results.length, errors, results })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/files/bulk-delete', async (req, res) => {
  const { paths, useTrash } = req.body as { paths: string[]; useTrash?: boolean }
  if (!paths?.length) return res.status(400).json({ error: 'paths is required' })
  const errors: string[] = []
  let deleted = 0
  for (const p of paths) {
    try {
      if (useTrash !== false) {
        try {
          await trashFile(p)
        } catch {
          const stat = await fs.stat(p)
          if (stat.isDirectory()) await fs.rm(p, { recursive: true })
          else await fs.unlink(p)
        }
      } else {
        const stat = await fs.stat(p)
        if (stat.isDirectory()) await fs.rm(p, { recursive: true })
        else await fs.unlink(p)
      }
      logAction('delete', p, null, 'success')
      deleted++
    } catch (err) {
      const msg = `${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`
      logAction('delete', p, null, 'error', msg)
      errors.push(msg)
    }
  }
  res.json({ deleted, errors })
})

// ─── Start ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.MANAGR_API_PORT) || 3456

app.listen(PORT, () => {
  console.log(`[managr-api] Running on http://localhost:${PORT}`)
  console.log(`[managr-api] Database: ${DB_PATH}`)
})

process.on('SIGINT', () => {
  engine.stop().then(() => db.close())
  process.exit(0)
})
