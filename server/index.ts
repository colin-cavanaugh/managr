#!/usr/bin/env node

/**
 * File Manager MCP Server
 *
 * A comprehensive MCP server for local PC file management.
 * Provides tools for organizing, searching, backing up files,
 * and managing automated rules with snapshot/rollback support.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ManagrDB } from './src/database.js'
import { RulesEngine } from './src/engine.js'
import type { RuleCondition, RuleAction, TriggerType } from './src/types.js'

// ─── Database & Engine ─────────────────────────────────────────────────────

const DB_PATH = path.join(os.homedir(), '.managr', 'managr.db')
const db = new ManagrDB(DB_PATH)
const engine = new RulesEngine(db)

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Recursively walk a directory, yielding file paths. */
async function* walkDir(dir: string, maxDepth = 10, currentDepth = 0): AsyncGenerator<string> {
  if (currentDepth > maxDepth) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return // skip inaccessible directories
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkDir(fullPath, maxDepth, currentDepth + 1)
    } else if (entry.isFile()) {
      yield fullPath
    }
  }
}

/** Get a file's MD5 hash for duplicate detection. */
async function fileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath)
  return crypto.createHash('md5').update(content).digest('hex')
}

/** Human-readable file size. */
function humanSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

/** Format a Date to a readable string. */
function fmtDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

/** Copy a file, creating parent dirs as needed. */
async function copyFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.copyFile(src, dest)
}
// ─── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  // ── Organize & Clean Up ──
  {
    name: 'list_directory',
    description:
      "List files and folders in a directory with details (size, modified date, type). Use 'recursive' for deep listing.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Absolute path to the directory' },
        recursive: { type: 'boolean', description: 'Recurse into subdirectories (default false)' },
        maxDepth: { type: 'number', description: 'Max recursion depth (default 3)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'find_duplicates',
    description: 'Scan a directory for duplicate files based on content hash. Returns groups of identical files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory to scan' },
        maxDepth: { type: 'number', description: 'Max recursion depth (default 5)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'organize_by_type',
    description:
      "Organize files in a directory into subfolders by file extension (e.g., Images/, Documents/, Videos/). Returns a preview of moves; set 'execute' to true to actually move files.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory to organize' },
        execute: { type: 'boolean', description: 'Actually move files (default false = dry run)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'bulk_rename',
    description: 'Rename files in a directory using a pattern. Supports {name}, {ext}, {index}, {date} placeholders.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory containing files to rename' },
        pattern: {
          type: 'string',
          description:
            'Rename pattern, e.g. "{name}_{date}{ext}" or "photo_{index}{ext}". Placeholders: {name} = original name without ext, {ext} = extension with dot, {index} = sequential number, {date} = YYYYMMDD',
        },
        filter: { type: 'string', description: "Glob-like extension filter, e.g. '.jpg' or '.png,.jpg'" },
        execute: { type: 'boolean', description: 'Actually rename (default false = dry run)' },
      },
      required: ['dirPath', 'pattern'],
    },
  },
  {
    name: 'get_folder_size',
    description: 'Calculate the total size of a directory and its contents, with a breakdown by file type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory to measure' },
        maxDepth: { type: 'number', description: 'Max recursion depth (default 10)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'find_large_files',
    description: 'Find the largest files in a directory tree. Helpful for freeing up disk space.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory to scan' },
        minSizeMB: { type: 'number', description: 'Minimum file size in MB (default 50)' },
        limit: { type: 'number', description: 'Max number of results (default 20)' },
        maxDepth: { type: 'number', description: 'Max recursion depth (default 10)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'find_old_files',
    description: "Find files that haven't been modified in a given number of days.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory to scan' },
        olderThanDays: { type: 'number', description: 'Files older than this many days (default 180)' },
        limit: { type: 'number', description: 'Max results (default 50)' },
        maxDepth: { type: 'number', description: 'Max recursion depth (default 10)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'move_files',
    description: 'Move one or more files to a destination directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of absolute file paths to move',
        },
        destination: { type: 'string', description: 'Destination directory' },
      },
      required: ['files', 'destination'],
    },
  },
  {
    name: 'delete_files',
    description:
      "Delete files (moves to a trash folder by default for safety). Set 'permanent' to true for permanent deletion.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of absolute file paths to delete',
        },
        permanent: { type: 'boolean', description: 'Permanently delete instead of trashing (default false)' },
      },
      required: ['files'],
    },
  },

  // ── Search & Retrieve ──
  {
    name: 'search_files',
    description: 'Search for files by name pattern (supports * and ? wildcards), extension, size range, or date range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory to search' },
        namePattern: { type: 'string', description: "Filename pattern with wildcards, e.g. 'report*' or '*.pdf'" },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: "Filter by extensions, e.g. ['.pdf', '.docx']",
        },
        minSizeMB: { type: 'number', description: 'Minimum file size in MB' },
        maxSizeMB: { type: 'number', description: 'Maximum file size in MB' },
        modifiedAfter: { type: 'string', description: 'ISO date string — only files modified after this date' },
        modifiedBefore: { type: 'string', description: 'ISO date string — only files modified before this date' },
        limit: { type: 'number', description: 'Max results (default 50)' },
        maxDepth: { type: 'number', description: 'Max recursion depth (default 10)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'search_file_contents',
    description: 'Search inside text-based files for a keyword or phrase. Returns matching files and line numbers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Directory to search' },
        query: { type: 'string', description: 'Text to search for (case-insensitive)' },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: "File extensions to search, e.g. ['.txt', '.md', '.log'] (default: common text types)",
        },
        maxDepth: { type: 'number', description: 'Max recursion depth (default 5)' },
        limit: { type: 'number', description: 'Max results (default 30)' },
      },
      required: ['dirPath', 'query'],
    },
  },
  {
    name: 'get_file_info',
    description: 'Get detailed metadata for a specific file (size, dates, permissions, type).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'read_text_file',
    description: 'Read the contents of a text file (with optional line range).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file' },
        startLine: { type: 'number', description: 'Start reading from this line (1-based, default 1)' },
        endLine: { type: 'number', description: 'Stop reading at this line (inclusive)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'get_disk_usage',
    description: 'Show disk usage summary for all drives on the system.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // ── Backup & Sync ──
  {
    name: 'backup_directory',
    description: 'Create a timestamped backup copy of a directory. Copies all contents to a backup location.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourcePath: { type: 'string', description: 'Directory to back up' },
        backupRoot: {
          type: 'string',
          description: 'Where to store the backup (default: source parent + _backups/)',
        },
        label: { type: 'string', description: 'Optional label for the backup folder name' },
      },
      required: ['sourcePath'],
    },
  },
  {
    name: 'sync_directories',
    description:
      "One-way sync from source to destination — copies new and updated files. Set 'deleteExtra' to remove files in dest that don't exist in source. Returns a preview by default; set 'execute' to true to apply.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Source directory' },
        destination: { type: 'string', description: 'Destination directory' },
        deleteExtra: {
          type: 'boolean',
          description: "Remove files in destination that aren't in source (default false)",
        },
        execute: { type: 'boolean', description: 'Actually sync (default false = dry run)' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a new directory (and any parent directories needed).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dirPath: { type: 'string', description: 'Absolute path of the directory to create' },
      },
      required: ['dirPath'],
    },
  },

  // ── Rules Engine ──
  {
    name: 'create_rule',
    description:
      'Create an automation rule. Rules watch directories and automatically act on files that match conditions. Returns the created rule with its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Human-readable rule name' },
        description: { type: 'string', description: 'What this rule does' },
        trigger: {
          type: 'string',
          description: 'What triggers the rule: file_created, file_modified, schedule, or manual',
          enum: ['file_created', 'file_modified', 'schedule', 'manual'],
        },
        watchPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories to watch (absolute paths)',
        },
        conditions: {
          type: 'array',
          description:
            'Conditions that must all be true. Each: { field, operator, value }. Fields: extension, name_pattern, size_gt, size_lt, older_than_days, newer_than_days, directory. Operators: equals, matches, contains, gt, lt.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: { type: 'string' },
              value: {},
            },
            required: ['field', 'operator', 'value'],
          },
        },
        actions: {
          type: 'array',
          description:
            'Actions to execute in order. Each: { type, destination?, pattern?, trash? }. Types: move, copy, rename, delete, backup.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              destination: { type: 'string' },
              pattern: { type: 'string' },
              trash: { type: 'boolean' },
            },
            required: ['type'],
          },
        },
        priority: { type: 'number', description: 'Lower = higher priority (default 100)' },
        enabled: { type: 'boolean', description: 'Whether the rule is active (default true)' },
      },
      required: ['name', 'trigger', 'watchPaths', 'conditions', 'actions'],
    },
  },
  {
    name: 'list_rules',
    description: 'List all automation rules, optionally filtering to only enabled rules.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        enabledOnly: { type: 'boolean', description: 'Only return enabled rules (default false)' },
      },
    },
  },
  {
    name: 'get_rule',
    description: 'Get a single rule by its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ruleId: { type: 'string', description: 'The rule ID' },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'update_rule',
    description: 'Update an existing rule. Only the provided fields are changed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ruleId: { type: 'string', description: 'The rule ID to update' },
        name: { type: 'string' },
        description: { type: 'string' },
        enabled: { type: 'boolean' },
        trigger: { type: 'string', enum: ['file_created', 'file_modified', 'schedule', 'manual'] },
        watchPaths: { type: 'array', items: { type: 'string' } },
        conditions: { type: 'array', items: { type: 'object' } },
        actions: { type: 'array', items: { type: 'object' } },
        priority: { type: 'number' },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'delete_rule',
    description: 'Delete an automation rule by its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ruleId: { type: 'string', description: 'The rule ID to delete' },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'run_rule',
    description:
      'Manually run a rule against its watch directories right now. Evaluates conditions and executes actions on matching files. Returns count of processed files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ruleId: { type: 'string', description: 'The rule ID to run' },
      },
      required: ['ruleId'],
    },
  },

  // ── Activity & Snapshots ──
  {
    name: 'get_activity_log',
    description: 'Get the recent activity log showing all file operations managr has performed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max entries to return (default 50)' },
        offset: { type: 'number', description: 'Skip this many entries (default 0)' },
        ruleId: { type: 'string', description: 'Filter to a specific rule ID' },
      },
    },
  },
  {
    name: 'get_snapshots',
    description: 'Get recent snapshot batches that can be rolled back. Each batch represents one rule execution.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max batches to return (default 20)' },
      },
    },
  },
  {
    name: 'rollback',
    description:
      'Undo a batch of file operations. Moves files back to their original locations, removes copies, and restores renames. Returns count of restored files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        batchId: { type: 'string', description: 'The snapshot batch ID to rollback' },
      },
      required: ['batchId'],
    },
  },

  // ── Watcher Control ──
  {
    name: 'start_watcher',
    description: 'Start the file watcher. It will monitor directories from all enabled rules and automatically trigger actions.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'stop_watcher',
    description: 'Stop the file watcher.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'watcher_status',
    description: 'Check whether the file watcher is running and which directories it is monitoring.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
]
// ─── Tool handlers ──────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    // ── list_directory ──
    case 'list_directory': {
      const dirPath = args.dirPath as string
      const recursive = (args.recursive as boolean) ?? false
      const maxDepth = (args.maxDepth as number) ?? 3

      if (!recursive) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        const results = []
        for (const entry of entries) {
          const full = path.join(dirPath, entry.name)
          try {
            const stat = await fs.stat(full)
            results.push({
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: entry.isFile() ? humanSize(stat.size) : '-',
              modified: fmtDate(stat.mtime),
            })
          } catch {
            results.push({ name: entry.name, type: 'unknown', size: '-', modified: '-' })
          }
        }
        return JSON.stringify({ path: dirPath, count: results.length, entries: results }, null, 2)
      }

      const results: Array<{ path: string; size: string; modified: string }> = []
      for await (const filePath of walkDir(dirPath, maxDepth)) {
        const stat = await fs.stat(filePath)
        results.push({
          path: path.relative(dirPath, filePath),
          size: humanSize(stat.size),
          modified: fmtDate(stat.mtime),
        })
        if (results.length >= 500) break
      }
      return JSON.stringify(
        { path: dirPath, fileCount: results.length, truncated: results.length >= 500, files: results },
        null,
        2
      )
    }

    // ── find_duplicates ──
    case 'find_duplicates': {
      const dirPath = args.dirPath as string
      const maxDepth = (args.maxDepth as number) ?? 5
      const hashMap = new Map<string, string[]>()

      for await (const filePath of walkDir(dirPath, maxDepth)) {
        try {
          const h = await fileHash(filePath)
          const group = hashMap.get(h) ?? []
          group.push(filePath)
          hashMap.set(h, group)
        } catch {
          // skip unreadable files
        }
      }

      const duplicates = Array.from(hashMap.entries())
        .filter(([, files]) => files.length > 1)
        .map(([hash, files]) => ({ hash, count: files.length, files }))

      const totalWaste = await Promise.all(
        duplicates.flatMap(g =>
          g.files.slice(1).map(async f => {
            try {
              return (await fs.stat(f)).size
            } catch {
              return 0
            }
          })
        )
      )

      return JSON.stringify(
        {
          scanned: dirPath,
          duplicateGroups: duplicates.length,
          potentialSpaceSaved: humanSize(totalWaste.reduce((a, b) => a + b, 0)),
          groups: duplicates.slice(0, 50),
        },
        null,
        2
      )
    }

    // ── organize_by_type ──
    case 'organize_by_type': {
      const dirPath = args.dirPath as string
      const execute = (args.execute as boolean) ?? false

      const categoryMap: Record<string, string> = {
        '.jpg': 'Images',
        '.jpeg': 'Images',
        '.png': 'Images',
        '.gif': 'Images',
        '.bmp': 'Images',
        '.svg': 'Images',
        '.webp': 'Images',
        '.ico': 'Images',
        '.mp4': 'Videos',
        '.avi': 'Videos',
        '.mkv': 'Videos',
        '.mov': 'Videos',
        '.wmv': 'Videos',
        '.flv': 'Videos',
        '.webm': 'Videos',
        '.mp3': 'Audio',
        '.wav': 'Audio',
        '.flac': 'Audio',
        '.aac': 'Audio',
        '.ogg': 'Audio',
        '.wma': 'Audio',
        '.m4a': 'Audio',
        '.pdf': 'Documents',
        '.doc': 'Documents',
        '.docx': 'Documents',
        '.xls': 'Documents',
        '.xlsx': 'Documents',
        '.ppt': 'Documents',
        '.pptx': 'Documents',
        '.txt': 'Documents',
        '.rtf': 'Documents',
        '.csv': 'Documents',
        '.md': 'Documents',
        '.zip': 'Archives',
        '.rar': 'Archives',
        '.7z': 'Archives',
        '.tar': 'Archives',
        '.gz': 'Archives',
        '.exe': 'Programs',
        '.msi': 'Programs',
        '.bat': 'Programs',
        '.cmd': 'Programs',
        '.ps1': 'Programs',
        '.js': 'Code',
        '.ts': 'Code',
        '.py': 'Code',
        '.java': 'Code',
        '.cpp': 'Code',
        '.c': 'Code',
        '.html': 'Code',
        '.css': 'Code',
        '.json': 'Code',
        '.xml': 'Code',
        '.yaml': 'Code',
        '.yml': 'Code',
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const moves: Array<{ from: string; to: string }> = []

      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        const category = categoryMap[ext] ?? 'Other'
        const destDir = path.join(dirPath, category)
        const destPath = path.join(destDir, entry.name)
        moves.push({ from: path.join(dirPath, entry.name), to: destPath })
      }

      if (execute) {
        let moved = 0
        for (const m of moves) {
          await fs.mkdir(path.dirname(m.to), { recursive: true })
          await fs.rename(m.from, m.to)
          moved++
        }
        return JSON.stringify({ status: 'completed', filesMoved: moved })
      }

      return JSON.stringify({ status: 'dry_run', plannedMoves: moves.length, moves }, null, 2)
    }

    // ── bulk_rename ──
    case 'bulk_rename': {
      const dirPath = args.dirPath as string
      const pattern = args.pattern as string
      const filter = args.filter as string | undefined
      const execute = (args.execute as boolean) ?? false

      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const renames: Array<{ from: string; to: string }> = []
      let index = 1

      const exts = filter ? filter.split(',').map(e => e.trim().toLowerCase()) : null

      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (exts && !exts.includes(ext)) continue

        const nameOnly = path.basename(entry.name, ext)
        const stat = await fs.stat(path.join(dirPath, entry.name))
        const dateStr = stat.mtime.toISOString().slice(0, 10).replace(/-/g, '')

        const newName = pattern
          .replace('{name}', nameOnly)
          .replace('{ext}', ext)
          .replace('{index}', String(index).padStart(3, '0'))
          .replace('{date}', dateStr)

        renames.push({ from: entry.name, to: newName })
        index++
      }

      if (execute) {
        for (const r of renames) {
          await fs.rename(path.join(dirPath, r.from), path.join(dirPath, r.to))
        }
        return JSON.stringify({ status: 'completed', filesRenamed: renames.length })
      }

      return JSON.stringify({ status: 'dry_run', plannedRenames: renames.length, renames }, null, 2)
    }

    // ── get_folder_size ──
    case 'get_folder_size': {
      const dirPath = args.dirPath as string
      const maxDepth = (args.maxDepth as number) ?? 10
      let totalSize = 0
      const byExt = new Map<string, number>()

      for await (const filePath of walkDir(dirPath, maxDepth)) {
        try {
          const stat = await fs.stat(filePath)
          totalSize += stat.size
          const ext = path.extname(filePath).toLowerCase() || '(no ext)'
          byExt.set(ext, (byExt.get(ext) ?? 0) + stat.size)
        } catch {
          // skip
        }
      }

      const breakdown = Array.from(byExt.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([ext, size]) => ({ extension: ext, size: humanSize(size), bytes: size }))

      return JSON.stringify(
        { path: dirPath, totalSize: humanSize(totalSize), totalBytes: totalSize, breakdown },
        null,
        2
      )
    }

    // ── find_large_files ──
    case 'find_large_files': {
      const dirPath = args.dirPath as string
      const minSize = ((args.minSizeMB as number) ?? 50) * 1024 * 1024
      const limit = (args.limit as number) ?? 20
      const maxDepth = (args.maxDepth as number) ?? 10
      const results: Array<{ path: string; size: string; bytes: number; modified: string }> = []

      for await (const filePath of walkDir(dirPath, maxDepth)) {
        try {
          const stat = await fs.stat(filePath)
          if (stat.size >= minSize) {
            results.push({
              path: filePath,
              size: humanSize(stat.size),
              bytes: stat.size,
              modified: fmtDate(stat.mtime),
            })
          }
        } catch {
          // skip
        }
      }

      results.sort((a, b) => b.bytes - a.bytes)
      return JSON.stringify({ scanned: dirPath, found: results.length, files: results.slice(0, limit) }, null, 2)
    }

    // ── find_old_files ──
    case 'find_old_files': {
      const dirPath = args.dirPath as string
      const olderThanDays = (args.olderThanDays as number) ?? 180
      const limit = (args.limit as number) ?? 50
      const maxDepth = (args.maxDepth as number) ?? 10
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      const results: Array<{ path: string; size: string; modified: string }> = []

      for await (const filePath of walkDir(dirPath, maxDepth)) {
        try {
          const stat = await fs.stat(filePath)
          if (stat.mtime.getTime() < cutoff) {
            results.push({ path: filePath, size: humanSize(stat.size), modified: fmtDate(stat.mtime) })
          }
        } catch {
          // skip
        }
        if (results.length >= limit) break
      }

      return JSON.stringify({ scanned: dirPath, olderThanDays, found: results.length, files: results }, null, 2)
    }

    // ── move_files ──
    case 'move_files': {
      const files = args.files as string[]
      const destination = args.destination as string
      await fs.mkdir(destination, { recursive: true })
      const results: Array<{ file: string; status: string }> = []

      for (const f of files) {
        try {
          const dest = path.join(destination, path.basename(f))
          await fs.rename(f, dest)
          results.push({ file: f, status: 'moved' })
        } catch (err) {
          results.push({ file: f, status: `error: ${(err as Error).message}` })
        }
      }
      return JSON.stringify({ destination, results })
    }

    // ── delete_files ──
    case 'delete_files': {
      const files = args.files as string[]
      const permanent = (args.permanent as boolean) ?? false
      const results: Array<{ file: string; status: string }> = []

      if (!permanent) {
        const trashDir = path.join(os.homedir(), '.file-manager-mcp-trash')
        await fs.mkdir(trashDir, { recursive: true })
        for (const f of files) {
          try {
            const dest = path.join(trashDir, `${Date.now()}_${path.basename(f)}`)
            await fs.rename(f, dest)
            results.push({ file: f, status: `trashed → ${dest}` })
          } catch (err) {
            results.push({ file: f, status: `error: ${(err as Error).message}` })
          }
        }
      } else {
        for (const f of files) {
          try {
            await fs.unlink(f)
            results.push({ file: f, status: 'permanently deleted' })
          } catch (err) {
            results.push({ file: f, status: `error: ${(err as Error).message}` })
          }
        }
      }
      return JSON.stringify({ results })
    }
    // ── search_files ──
    case 'search_files': {
      const dirPath = args.dirPath as string
      const namePattern = args.namePattern as string | undefined
      const extensions = args.extensions as string[] | undefined
      const minSize = args.minSizeMB ? (args.minSizeMB as number) * 1024 * 1024 : undefined
      const maxSize = args.maxSizeMB ? (args.maxSizeMB as number) * 1024 * 1024 : undefined
      const modAfter = args.modifiedAfter ? new Date(args.modifiedAfter as string).getTime() : undefined
      const modBefore = args.modifiedBefore ? new Date(args.modifiedBefore as string).getTime() : undefined
      const limit = (args.limit as number) ?? 50
      const maxDepth = (args.maxDepth as number) ?? 10

      const regex = namePattern
        ? new RegExp('^' + namePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
        : null

      const results: Array<{ path: string; size: string; modified: string }> = []

      for await (const filePath of walkDir(dirPath, maxDepth)) {
        const name = path.basename(filePath)
        if (regex && !regex.test(name)) continue
        if (extensions) {
          const ext = path.extname(name).toLowerCase()
          if (!extensions.map(e => e.toLowerCase()).includes(ext)) continue
        }
        try {
          const stat = await fs.stat(filePath)
          if (minSize !== undefined && stat.size < minSize) continue
          if (maxSize !== undefined && stat.size > maxSize) continue
          if (modAfter !== undefined && stat.mtime.getTime() < modAfter) continue
          if (modBefore !== undefined && stat.mtime.getTime() > modBefore) continue
          results.push({ path: filePath, size: humanSize(stat.size), modified: fmtDate(stat.mtime) })
        } catch {
          continue
        }
        if (results.length >= limit) break
      }

      return JSON.stringify({ scanned: dirPath, found: results.length, files: results }, null, 2)
    }

    // ── search_file_contents ──
    case 'search_file_contents': {
      const dirPath = args.dirPath as string
      const query = (args.query as string).toLowerCase()
      const extensions = (args.extensions as string[]) ?? [
        '.txt',
        '.md',
        '.log',
        '.csv',
        '.json',
        '.xml',
        '.yaml',
        '.yml',
        '.html',
        '.css',
        '.js',
        '.ts',
        '.py',
        '.java',
        '.c',
        '.cpp',
        '.ini',
        '.cfg',
        '.conf',
        '.bat',
        '.ps1',
        '.sh',
      ]
      const maxDepth = (args.maxDepth as number) ?? 5
      const limit = (args.limit as number) ?? 30

      const results: Array<{ path: string; matches: Array<{ line: number; text: string }> }> = []

      for await (const filePath of walkDir(dirPath, maxDepth)) {
        if (!extensions.includes(path.extname(filePath).toLowerCase())) continue
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          const lines = content.split('\n')
          const matches: Array<{ line: number; text: string }> = []
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query)) {
              matches.push({ line: i + 1, text: lines[i].trim().substring(0, 200) })
            }
          }
          if (matches.length > 0) {
            results.push({ path: filePath, matches: matches.slice(0, 5) })
          }
        } catch {
          // skip binary or unreadable files
        }
        if (results.length >= limit) break
      }

      return JSON.stringify({ scanned: dirPath, query, filesMatched: results.length, results }, null, 2)
    }

    // ── get_file_info ──
    case 'get_file_info': {
      const filePath = args.filePath as string
      const stat = await fs.stat(filePath)
      return JSON.stringify(
        {
          path: filePath,
          name: path.basename(filePath),
          extension: path.extname(filePath),
          size: humanSize(stat.size),
          sizeBytes: stat.size,
          created: fmtDate(stat.birthtime),
          modified: fmtDate(stat.mtime),
          accessed: fmtDate(stat.atime),
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
          isSymlink: stat.isSymbolicLink(),
        },
        null,
        2
      )
    }

    // ── read_text_file ──
    case 'read_text_file': {
      const filePath = args.filePath as string
      const startLine = (args.startLine as number) ?? 1
      const endLine = args.endLine as number | undefined
      const content = await fs.readFile(filePath, 'utf-8')
      const lines = content.split('\n')
      const slice = lines.slice(startLine - 1, endLine ?? lines.length)
      return JSON.stringify({
        path: filePath,
        totalLines: lines.length,
        showing: `${startLine}-${endLine ?? lines.length}`,
        content: slice.join('\n'),
      })
    }

    // ── get_disk_usage ──
    case 'get_disk_usage': {
      const platform = os.platform()
      const homedir = os.homedir()
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      return JSON.stringify(
        {
          platform,
          homedir,
          totalMemory: humanSize(totalMem),
          freeMemory: humanSize(freeMem),
          note:
            "For detailed disk usage per drive on Windows, use 'wmic logicaldisk get size,freespace,caption' in your terminal.",
        },
        null,
        2
      )
    }

    // ── backup_directory ──
    case 'backup_directory': {
      const sourcePath = args.sourcePath as string
      const label = (args.label as string) ?? 'backup'
      const backupRoot =
        (args.backupRoot as string) ?? path.join(path.dirname(sourcePath), `${path.basename(sourcePath)}_backups`)

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const backupDir = path.join(backupRoot, `${label}_${timestamp}`)

      let filesCopied = 0
      for await (const filePath of walkDir(sourcePath, 20)) {
        const rel = path.relative(sourcePath, filePath)
        const dest = path.join(backupDir, rel)
        await copyFile(filePath, dest)
        filesCopied++
      }

      return JSON.stringify({ status: 'completed', source: sourcePath, backupLocation: backupDir, filesCopied })
    }

    // ── sync_directories ──
    case 'sync_directories': {
      const source = args.source as string
      const destination = args.destination as string
      const deleteExtra = (args.deleteExtra as boolean) ?? false
      const execute = (args.execute as boolean) ?? false

      const toCopy: string[] = []
      const toDelete: string[] = []

      for await (const srcFile of walkDir(source, 20)) {
        const rel = path.relative(source, srcFile)
        const destFile = path.join(destination, rel)
        try {
          const srcStat = await fs.stat(srcFile)
          const destStat = await fs.stat(destFile)
          if (srcStat.mtime > destStat.mtime) {
            toCopy.push(rel)
          }
        } catch {
          toCopy.push(rel)
        }
      }

      if (deleteExtra) {
        for await (const destFile of walkDir(destination, 20)) {
          const rel = path.relative(destination, destFile)
          const srcFile = path.join(source, rel)
          try {
            await fs.stat(srcFile)
          } catch {
            toDelete.push(rel)
          }
        }
      }

      if (execute) {
        for (const rel of toCopy) {
          await copyFile(path.join(source, rel), path.join(destination, rel))
        }
        for (const rel of toDelete) {
          await fs.unlink(path.join(destination, rel))
        }
        return JSON.stringify({
          status: 'completed',
          filesCopied: toCopy.length,
          filesDeleted: toDelete.length,
        })
      }

      return JSON.stringify(
        {
          status: 'dry_run',
          filesToCopy: toCopy.length,
          filesToDelete: toDelete.length,
          copy: toCopy.slice(0, 50),
          delete: toDelete.slice(0, 50),
        },
        null,
        2
      )
    }

    // ── create_directory ──
    case 'create_directory': {
      const dirPath = args.dirPath as string
      await fs.mkdir(dirPath, { recursive: true })
      return JSON.stringify({ status: 'created', path: dirPath })
    }

    // ── Rules Engine ──────────────────────────────────────────────────────

    case 'create_rule': {
      const rule = db.createRule({
        name: args.name as string,
        description: (args.description as string) ?? undefined,
        enabled: (args.enabled as boolean) ?? true,
        trigger: args.trigger as TriggerType,
        watchPaths: args.watchPaths as string[],
        conditions: args.conditions as RuleCondition[],
        actions: args.actions as RuleAction[],
        priority: (args.priority as number) ?? 100,
      })
      engine.refresh()
      return JSON.stringify({ status: 'created', rule }, null, 2)
    }

    case 'list_rules': {
      const enabledOnly = (args.enabledOnly as boolean) ?? false
      const rules = db.listRules(enabledOnly)
      return JSON.stringify({ count: rules.length, rules }, null, 2)
    }

    case 'get_rule': {
      const rule = db.getRule(args.ruleId as string)
      if (!rule) return JSON.stringify({ error: 'Rule not found' })
      return JSON.stringify(rule, null, 2)
    }

    case 'update_rule': {
      const { ruleId, ...updates } = args as Record<string, unknown>
      const rule = db.updateRule(ruleId as string, updates as Parameters<typeof db.updateRule>[1])
      if (!rule) return JSON.stringify({ error: 'Rule not found' })
      engine.refresh()
      return JSON.stringify({ status: 'updated', rule }, null, 2)
    }

    case 'delete_rule': {
      const deleted = db.deleteRule(args.ruleId as string)
      if (!deleted) return JSON.stringify({ error: 'Rule not found' })
      engine.refresh()
      return JSON.stringify({ status: 'deleted', ruleId: args.ruleId })
    }

    case 'run_rule': {
      const result = await engine.runRule(args.ruleId as string)
      return JSON.stringify({ status: 'completed', ...result }, null, 2)
    }

    // ── Activity & Snapshots ──────────────────────────────────────────────

    case 'get_activity_log': {
      const limit = (args.limit as number) ?? 50
      const offset = (args.offset as number) ?? 0
      const ruleId = args.ruleId as string | undefined

      const entries = ruleId
        ? db.getActivityByRule(ruleId, limit)
        : db.getActivityLog(limit, offset)

      return JSON.stringify({ count: entries.length, entries }, null, 2)
    }

    case 'get_snapshots': {
      const limit = (args.limit as number) ?? 20
      const batches = db.getRecentSnapshots(limit)
      return JSON.stringify({ count: batches.length, batches }, null, 2)
    }

    case 'rollback': {
      const result = await engine.rollback(args.batchId as string)
      return JSON.stringify({ status: 'rolled_back', ...result }, null, 2)
    }

    // ── Watcher Control ───────────────────────────────────────────────────

    case 'start_watcher': {
      engine.start()
      return JSON.stringify({ status: 'started', watchedPaths: engine['watcher'].watchedPaths() })
    }

    case 'stop_watcher': {
      await engine.stop()
      return JSON.stringify({ status: 'stopped' })
    }

    case 'watcher_status': {
      const watcher = engine['watcher']
      return JSON.stringify({
        running: watcher.isRunning(),
        watchedPaths: watcher.watchedPaths(),
      }, null, 2)
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ─── Server setup ───────────────────────────────────────────────────────────

const server = new Server({ name: 'file-manager-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS }
})

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params
  try {
    const result = await handleTool(name, (args as Record<string, unknown>) ?? {})
    return { content: [{ type: 'text', text: result }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
  }
})

async function main() {
  console.error(`[managr] Database: ${DB_PATH}`)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[managr] MCP server running on stdio')
}

process.on('SIGINT', () => {
  engine.stop().then(() => db.close())
})

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
