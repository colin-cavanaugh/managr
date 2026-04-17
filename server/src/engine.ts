/**
 * managr — Rules engine
 *
 * Evaluates file events against rules, executes matching actions,
 * creates snapshots for rollback, and logs all activity.
 */

import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { ManagrDB } from './database.js'
import { FileWatcher, type WatchEvent } from './watcher.js'
import type { Rule, RuleCondition, RuleAction, ActionType } from './types.js'

export class RulesEngine {
  private db: ManagrDB
  private watcher: FileWatcher
  private processing = false

  constructor(db: ManagrDB) {
    this.db = db
    this.watcher = new FileWatcher()
    this.watcher.onEvent(event => this.handleEvent(event))
  }

  /** Start watching directories for all enabled rules. */
  start(): void {
    const rules = this.db.listRules(true)
    const dirs = rules.flatMap(r => r.watchPaths)
    this.watcher.watch(dirs)
    console.error(`[engine] Started — watching ${dirs.length} directories for ${rules.length} rules`)
  }

  /** Stop the watcher and engine. */
  async stop(): Promise<void> {
    await this.watcher.stop()
    console.error('[engine] Stopped')
  }

  /** Re-sync watched directories after rule changes. */
  refresh(): void {
    const rules = this.db.listRules(true)
    const dirs = rules.flatMap(r => r.watchPaths)
    this.watcher.sync(dirs)
  }

  /** Manually run a specific rule against a directory (for manual trigger type). */
  async runRule(ruleId: string): Promise<{ processed: number; errors: number }> {
    const rule = this.db.getRule(ruleId)
    if (!rule) throw new Error(`Rule not found: ${ruleId}`)

    let processed = 0
    let errors = 0

    for (const dir of rule.watchPaths) {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        errors++
        continue
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = path.join(dir, entry.name)

        if (await this.evaluateConditions(filePath, rule.conditions)) {
          const result = await this.executeActions(filePath, rule)
          if (result) processed++
          else errors++
        }
      }
    }

    return { processed, errors }
  }

  /** Rollback a batch of actions using snapshot data. */
  async rollback(batchId: string): Promise<{ restored: number; errors: string[] }> {
    const snapshots = this.db.getSnapshotsByBatch(batchId)
    if (snapshots.length === 0) throw new Error(`No snapshots found for batch: ${batchId}`)

    let restored = 0
    const errors: string[] = []

    // Process in reverse order to undo correctly
    for (const snap of [...snapshots].reverse()) {
      if (snap.rolledBack) continue

      try {
        switch (snap.action) {
          case 'move':
          case 'rename':
            if (snap.newPath) {
              await fs.mkdir(path.dirname(snap.originalPath), { recursive: true })
              await fs.rename(snap.newPath, snap.originalPath)
            }
            break
          case 'copy':
            if (snap.newPath) {
              await fs.unlink(snap.newPath)
            }
            break
          case 'delete':
            // Cannot restore deleted files unless we backed them up
            errors.push(`Cannot restore deleted file: ${snap.originalPath}`)
            continue
          default:
            break
        }

        this.db.logActivity({
          ruleId: null,
          ruleName: 'rollback',
          action: snap.action as ActionType,
          sourcePath: snap.newPath ?? snap.originalPath,
          destPath: snap.originalPath,
          status: 'rolled_back',
          snapshotId: snap.id,
        })

        restored++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`Failed to restore ${snap.originalPath}: ${msg}`)
      }
    }

    this.db.markBatchRolledBack(batchId)
    return { restored, errors }
  }

  // ── Event handling ────────────────────────────────────────────────────

  private async handleEvent(event: WatchEvent): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      const rules = this.db.listRules(true)
      const matching = rules
        .filter(r => r.trigger === event.type)
        .filter(r => r.watchPaths.some(wp => event.directory === wp || event.directory.startsWith(wp + path.sep)))

      for (const rule of matching) {
        if (await this.evaluateConditions(event.filePath, rule.conditions)) {
          await this.executeActions(event.filePath, rule)
        }
      }
    } catch (err) {
      console.error('[engine] Error handling event:', err)
    } finally {
      this.processing = false
    }
  }

  // ── Condition evaluation ──────────────────────────────────────────────

  private async evaluateConditions(filePath: string, conditions: RuleCondition[]): Promise<boolean> {
    let stat
    try {
      stat = await fs.stat(filePath)
    } catch {
      return false
    }

    const ext = path.extname(filePath).toLowerCase()
    const basename = path.basename(filePath)
    const dir = path.dirname(filePath)
    const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)

    for (const cond of conditions) {
      let match = false

      switch (cond.field) {
        case 'extension':
          match = compareString(ext, cond.operator, String(cond.value).toLowerCase())
          break
        case 'name_pattern':
          match = compareString(basename, cond.operator, String(cond.value))
          break
        case 'size_gt':
          match = stat.size > Number(cond.value)
          break
        case 'size_lt':
          match = stat.size < Number(cond.value)
          break
        case 'older_than_days':
          match = ageDays > Number(cond.value)
          break
        case 'newer_than_days':
          match = ageDays < Number(cond.value)
          break
        case 'directory':
          match = compareString(dir, cond.operator, String(cond.value))
          break
      }

      if (!match) return false
    }

    return true
  }

  // ── Action execution ──────────────────────────────────────────────────

  private async executeActions(filePath: string, rule: Rule): Promise<boolean> {
    const batchId = randomUUID()
    let currentPath = filePath

    for (const action of rule.actions) {
      try {
        const stat = await fs.stat(currentPath)

        // Create snapshot before acting
        let fileHash: string | null = null
        try {
          const content = await fs.readFile(currentPath)
          fileHash = crypto.createHash('md5').update(content).digest('hex')
        } catch {
          // Skip hash for unreadable files
        }

        const newPath = await this.executeAction(currentPath, action)

        this.db.createSnapshot({
          batchId,
          originalPath: currentPath,
          newPath,
          fileHash,
          fileSize: stat.size,
          action: action.type,
        })

        this.db.logActivity({
          ruleId: rule.id,
          ruleName: rule.name,
          action: action.type,
          sourcePath: currentPath,
          destPath: newPath,
          status: 'success',
          snapshotId: batchId,
        })

        // Update current path for chained actions
        if (newPath) currentPath = newPath
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.db.logActivity({
          ruleId: rule.id,
          ruleName: rule.name,
          action: action.type,
          sourcePath: currentPath,
          destPath: null,
          status: 'error',
          error: message,
          snapshotId: batchId,
        })
        console.error(`[engine] Action ${action.type} failed on ${currentPath}: ${message}`)
        return false
      }
    }

    return true
  }

  private async executeAction(filePath: string, action: RuleAction): Promise<string | null> {
    switch (action.type) {
      case 'move': {
        if (!action.destination) throw new Error('Move action requires a destination')
        const dest = path.join(action.destination, path.basename(filePath))
        await fs.mkdir(action.destination, { recursive: true })
        await fs.rename(filePath, dest)
        return dest
      }

      case 'copy': {
        if (!action.destination) throw new Error('Copy action requires a destination')
        const dest = path.join(action.destination, path.basename(filePath))
        await fs.mkdir(action.destination, { recursive: true })
        await fs.copyFile(filePath, dest)
        return dest
      }

      case 'rename': {
        if (!action.pattern) throw new Error('Rename action requires a pattern')
        const dir = path.dirname(filePath)
        const ext = path.extname(filePath)
        const name = path.basename(filePath, ext)
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')

        let newName = action.pattern
          .replace('{name}', name)
          .replace('{ext}', ext)
          .replace('{date}', date)

        // Auto-append original extension if the pattern didn't include {ext}
        if (!action.pattern.includes('{ext}') && ext) newName += ext

        const dest = path.join(dir, newName)
        await fs.rename(filePath, dest)
        return dest
      }

      case 'delete': {
        // TODO: implement trash support via platform-specific trash CLI
        await fs.unlink(filePath)
        return null
      }

      case 'backup': {
        if (!action.destination) throw new Error('Backup action requires a destination')
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupName = `${path.basename(filePath, path.extname(filePath))}_${timestamp}${path.extname(filePath)}`
        const dest = path.join(action.destination, backupName)
        await fs.mkdir(action.destination, { recursive: true })
        await fs.copyFile(filePath, dest)
        return dest
      }

      default:
        throw new Error(`Unsupported action type: ${action.type}`)
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function compareString(actual: string, operator: string, expected: string): boolean {
  switch (operator) {
    case 'equals':
      return actual === expected
    case 'contains':
      return actual.includes(expected)
    case 'matches': {
      // Convert simple glob to regex: * → .*, ? → .
      const regex = new RegExp('^' + expected.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
      return regex.test(actual)
    }
    default:
      return actual === expected
  }
}
