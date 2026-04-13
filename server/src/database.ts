/**
 * managr — SQLite database layer
 *
 * Provides optional local persistence for rules, activity logs, snapshots,
 * and configuration. Falls back gracefully when no database is connected.
 */

import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type {
  ActivityEntry,
  ActivityStatus,
  ActionType,
  Rule,
  SnapshotEntry,
  TriggerType,
} from './types.js'

// ─── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rules (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    trigger_type  TEXT NOT NULL,
    watch_paths   TEXT NOT NULL,  -- JSON array
    conditions    TEXT NOT NULL,  -- JSON array
    actions       TEXT NOT NULL,  -- JSON array
    priority      INTEGER NOT NULL DEFAULT 100,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id            TEXT PRIMARY KEY,
    rule_id       TEXT,
    rule_name     TEXT,
    action        TEXT NOT NULL,
    source_path   TEXT NOT NULL,
    dest_path     TEXT,
    status        TEXT NOT NULL,
    error         TEXT,
    snapshot_id   TEXT,
    timestamp     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id            TEXT PRIMARY KEY,
    batch_id      TEXT NOT NULL,
    original_path TEXT NOT NULL,
    new_path      TEXT,
    file_hash     TEXT,
    file_size     INTEGER NOT NULL,
    action        TEXT NOT NULL,
    rolled_back   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS frequent_dirs (
    path       TEXT PRIMARY KEY,
    visit_count INTEGER NOT NULL DEFAULT 1,
    last_visited TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pinned_dirs (
    id         TEXT PRIMARY KEY,
    path       TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_activity_rule ON activity_log(rule_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_batch ON snapshots(batch_id);
  CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);
  CREATE INDEX IF NOT EXISTS idx_frequent_visits ON frequent_dirs(visit_count DESC);
`

// ─── Database class ─────────────────────────────────────────────────────────

export class ManagrDB {
  private db: Database.Database

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  // ── Rules ───────────────────────────────────────────────────────────────

  createRule(rule: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>): Rule {
    const now = new Date().toISOString()
    const id = randomUUID()
    const full: Rule = { ...rule, id, createdAt: now, updatedAt: now }

    this.db
      .prepare(
        `INSERT INTO rules (id, name, description, enabled, trigger_type, watch_paths, conditions, actions, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        full.id,
        full.name,
        full.description ?? null,
        full.enabled ? 1 : 0,
        full.trigger,
        JSON.stringify(full.watchPaths),
        JSON.stringify(full.conditions),
        JSON.stringify(full.actions),
        full.priority,
        full.createdAt,
        full.updatedAt
      )

    return full
  }

  getRule(id: string): Rule | null {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined
    return row ? rowToRule(row) : null
  }

  listRules(enabledOnly = false): Rule[] {
    const sql = enabledOnly ? 'SELECT * FROM rules WHERE enabled = 1 ORDER BY priority' : 'SELECT * FROM rules ORDER BY priority'
    const rows = this.db.prepare(sql).all() as RuleRow[]
    return rows.map(rowToRule)
  }

  updateRule(id: string, updates: Partial<Omit<Rule, 'id' | 'createdAt'>>): Rule | null {
    const existing = this.getRule(id)
    if (!existing) return null

    const merged: Rule = {
      ...existing,
      ...updates,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }

    this.db
      .prepare(
        `UPDATE rules SET name=?, description=?, enabled=?, trigger_type=?, watch_paths=?, conditions=?, actions=?, priority=?, updated_at=?
         WHERE id=?`
      )
      .run(
        merged.name,
        merged.description ?? null,
        merged.enabled ? 1 : 0,
        merged.trigger,
        JSON.stringify(merged.watchPaths),
        JSON.stringify(merged.conditions),
        JSON.stringify(merged.actions),
        merged.priority,
        merged.updatedAt,
        id
      )

    return merged
  }

  deleteRule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM rules WHERE id = ?').run(id)
    return result.changes > 0
  }

  // ── Activity Log ────────────────────────────────────────────────────────

  logActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): ActivityEntry {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    const full: ActivityEntry = { ...entry, id, timestamp }

    this.db
      .prepare(
        `INSERT INTO activity_log (id, rule_id, rule_name, action, source_path, dest_path, status, error, snapshot_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(full.id, full.ruleId, full.ruleName, full.action, full.sourcePath, full.destPath, full.status, full.error ?? null, full.snapshotId, full.timestamp)

    return full
  }

  getActivityLog(limit = 50, offset = 0): ActivityEntry[] {
    const rows = this.db.prepare('SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset) as ActivityRow[]
    return rows.map(rowToActivity)
  }

  getActivityByRule(ruleId: string, limit = 50): ActivityEntry[] {
    const rows = this.db.prepare('SELECT * FROM activity_log WHERE rule_id = ? ORDER BY timestamp DESC LIMIT ?').all(ruleId, limit) as ActivityRow[]
    return rows.map(rowToActivity)
  }

  // ── Snapshots ───────────────────────────────────────────────────────────

  createSnapshot(entry: Omit<SnapshotEntry, 'id' | 'rolledBack' | 'createdAt'>): SnapshotEntry {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const full: SnapshotEntry = { ...entry, id, rolledBack: false, createdAt }

    this.db
      .prepare(
        `INSERT INTO snapshots (id, batch_id, original_path, new_path, file_hash, file_size, action, rolled_back, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(full.id, full.batchId, full.originalPath, full.newPath, full.fileHash, full.fileSize, full.action, full.createdAt)

    return full
  }

  getSnapshotsByBatch(batchId: string): SnapshotEntry[] {
    const rows = this.db.prepare('SELECT * FROM snapshots WHERE batch_id = ? ORDER BY created_at').all(batchId) as SnapshotRow[]
    return rows.map(rowToSnapshot)
  }

  getRecentSnapshots(limit = 20): { batchId: string; fileCount: number; action: string; createdAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT batch_id, COUNT(*) as file_count, action, MIN(created_at) as created_at
         FROM snapshots WHERE rolled_back = 0
         GROUP BY batch_id ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as { batch_id: string; file_count: number; action: string; created_at: string }[]

    return rows.map(r => ({
      batchId: r.batch_id,
      fileCount: r.file_count,
      action: r.action,
      createdAt: r.created_at,
    }))
  }

  markBatchRolledBack(batchId: string): number {
    const result = this.db.prepare('UPDATE snapshots SET rolled_back = 1 WHERE batch_id = ?').run(batchId)
    return result.changes
  }

  // ── Config ──────────────────────────────────────────────────────────────

  getConfig(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setConfig(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value)
  }

  getFullConfig(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM config').all() as { key: string; value: string }[]
    const config: Record<string, string> = {}
    for (const row of rows) {
      config[row.key] = row.value
    }
    return config
  }

  // ── Frequent Dirs ─────────────────────────────────────────────────────

  recordVisit(dirPath: string): void {
    const now = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO frequent_dirs (path, visit_count, last_visited) VALUES (?, 1, ?)
       ON CONFLICT(path) DO UPDATE SET visit_count = visit_count + 1, last_visited = ?`
    ).run(dirPath, now, now)
  }

  getFrequentDirs(limit = 4): { path: string; visitCount: number; lastVisited: string }[] {
    const rows = this.db.prepare(
      'SELECT path, visit_count, last_visited FROM frequent_dirs ORDER BY visit_count DESC, last_visited DESC LIMIT ?'
    ).all(limit) as { path: string; visit_count: number; last_visited: string }[]
    return rows.map(r => ({ path: r.path, visitCount: r.visit_count, lastVisited: r.last_visited }))
  }

  // ── Pinned Dirs ───────────────────────────────────────────────────────

  pinDir(dirPath: string, label: string): { id: string; path: string; label: string } {
    const id = randomUUID()
    const now = new Date().toISOString()
    const maxOrder = this.db.prepare('SELECT MAX(sort_order) as m FROM pinned_dirs').get() as { m: number | null }
    const order = (maxOrder.m ?? -1) + 1
    this.db.prepare(
      'INSERT OR IGNORE INTO pinned_dirs (id, path, label, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, dirPath, label, order, now)
    return { id, path: dirPath, label }
  }

  unpinDir(dirPath: string): boolean {
    const result = this.db.prepare('DELETE FROM pinned_dirs WHERE path = ?').run(dirPath)
    return result.changes > 0
  }

  getPinnedDirs(): { id: string; path: string; label: string }[] {
    const rows = this.db.prepare('SELECT id, path, label FROM pinned_dirs ORDER BY sort_order').all() as { id: string; path: string; label: string }[]
    return rows
  }
}

// ─── Row type helpers ───────────────────────────────────────────────────────

interface RuleRow {
  id: string
  name: string
  description: string | null
  enabled: number
  trigger_type: string
  watch_paths: string
  conditions: string
  actions: string
  priority: number
  created_at: string
  updated_at: string
}

interface ActivityRow {
  id: string
  rule_id: string | null
  rule_name: string | null
  action: string
  source_path: string
  dest_path: string | null
  status: string
  error: string | null
  snapshot_id: string | null
  timestamp: string
}

interface SnapshotRow {
  id: string
  batch_id: string
  original_path: string
  new_path: string | null
  file_hash: string | null
  file_size: number
  action: string
  rolled_back: number
  created_at: string
}

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    trigger: row.trigger_type as TriggerType,
    watchPaths: JSON.parse(row.watch_paths),
    conditions: JSON.parse(row.conditions),
    actions: JSON.parse(row.actions),
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToActivity(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    action: row.action as ActionType,
    sourcePath: row.source_path,
    destPath: row.dest_path,
    status: row.status as ActivityStatus,
    error: row.error ?? undefined,
    snapshotId: row.snapshot_id,
    timestamp: row.timestamp,
  }
}

function rowToSnapshot(row: SnapshotRow): SnapshotEntry {
  return {
    id: row.id,
    batchId: row.batch_id,
    originalPath: row.original_path,
    newPath: row.new_path,
    fileHash: row.file_hash,
    fileSize: row.file_size,
    action: row.action as ActionType,
    rolledBack: row.rolled_back === 1,
    createdAt: row.created_at,
  }
}
