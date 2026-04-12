/**
 * managr — Core type definitions
 *
 * These types define the rule engine, snapshot system, and activity log
 * that power managr's automated file management.
 */

// ─── Rules ──────────────────────────────────────────────────────────────────

export type TriggerType = 'file_created' | 'file_modified' | 'schedule' | 'manual'

export type ConditionField = 'extension' | 'name_pattern' | 'size_gt' | 'size_lt' | 'older_than_days' | 'newer_than_days' | 'directory'

export interface RuleCondition {
  field: ConditionField
  /** Operator for matching. 'equals' for exact, 'matches' for glob/regex, 'contains' for substring. */
  operator: 'equals' | 'matches' | 'contains' | 'gt' | 'lt'
  value: string | number
}

export type ActionType = 'move' | 'copy' | 'rename' | 'delete' | 'organize_by_type' | 'backup'

export interface RuleAction {
  type: ActionType
  /** Destination directory for move/copy/backup actions. */
  destination?: string
  /** Rename pattern using placeholders: {name}, {ext}, {date}, {index}. */
  pattern?: string
  /** Whether to send the file to trash instead of permanent delete. */
  trash?: boolean
}

export interface Rule {
  id: string
  name: string
  description?: string
  enabled: boolean
  /** What triggers the rule to evaluate. */
  trigger: TriggerType
  /** Directory (or directories) this rule watches. */
  watchPaths: string[]
  /** All conditions must be true for the rule to fire. */
  conditions: RuleCondition[]
  /** Actions executed in order when the rule fires. */
  actions: RuleAction[]
  /** Lower number = higher priority. Default 100. */
  priority: number
  createdAt: string
  updatedAt: string
}

// ─── Activity Log ───────────────────────────────────────────────────────────

export type ActivityStatus = 'success' | 'error' | 'rolled_back'

export interface ActivityEntry {
  id: string
  ruleId: string | null
  ruleName: string | null
  action: ActionType
  sourcePath: string
  destPath: string | null
  status: ActivityStatus
  error?: string
  snapshotId: string | null
  timestamp: string
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  id: string
  /** Groups all file states from a single rule execution. */
  batchId: string
  originalPath: string
  newPath: string | null
  fileHash: string | null
  fileSize: number
  action: ActionType
  /** Whether this snapshot has been used to rollback. */
  rolledBack: boolean
  createdAt: string
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface AppConfig {
  /** Whether the file watcher daemon is active. */
  watcherEnabled: boolean
  /** Directories the watcher monitors by default. */
  defaultWatchPaths: string[]
  /** Where to store backups. */
  backupDirectory: string
  /** Max activity log entries to retain. */
  maxLogEntries: number
  /** Whether to use trash instead of permanent delete. */
  useTrash: boolean
}

export const DEFAULT_CONFIG: AppConfig = {
  watcherEnabled: false,
  defaultWatchPaths: [],
  backupDirectory: '',
  maxLogEntries: 10000,
  useTrash: true,
}
