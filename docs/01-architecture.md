# managr — Architecture

## Overview

managr is a cross-platform file automation tool. Users define rules that watch directories and automatically organize, move, rename, back up, or clean up files. Every action is logged and reversible via snapshots.

## System layers

```
┌──────────────────────────────────┐
│         React Dashboard          │  Rule builder, activity feed, storage stats
├──────────────────────────────────┤
│          MCP Server              │  Tool interface for AI-assisted file ops
├──────────────────────────────────┤
│         Rules Engine             │  Evaluates conditions, executes actions
├──────────┬───────────────────────┤
│ Watcher  │   Snapshot Manager    │  chokidar fs events / rollback support
├──────────┴───────────────────────┤
│     SQLite (better-sqlite3)      │  Rules, activity log, snapshots, config
└──────────────────────────────────┘
```

## Data models

### Rule

A rule consists of a trigger, conditions, and actions.

| Field        | Type       | Description                                    |
|--------------|------------|------------------------------------------------|
| id           | UUID       | Primary key                                    |
| name         | string     | Human-readable label                           |
| trigger      | enum       | `file_created`, `file_modified`, `schedule`, `manual` |
| watchPaths   | string[]   | Directories this rule monitors                 |
| conditions   | Condition[]| All must be true for the rule to fire          |
| actions      | Action[]   | Executed in order when the rule fires          |
| priority     | number     | Lower = higher priority (default 100)          |
| enabled      | boolean    | Toggle without deleting                        |

### Condition

| Field    | Type   | Values                                                  |
|----------|--------|---------------------------------------------------------|
| field    | enum   | `extension`, `name_pattern`, `size_gt`, `size_lt`, `older_than_days`, `newer_than_days`, `directory` |
| operator | enum   | `equals`, `matches`, `contains`, `gt`, `lt`             |
| value    | mixed  | Compared against the file's actual value                |

### Action

| Field       | Type   | Description                            |
|-------------|--------|----------------------------------------|
| type        | enum   | `move`, `copy`, `rename`, `delete`, `organize_by_type`, `backup` |
| destination | string | Target directory (move/copy/backup)    |
| pattern     | string | Rename template with `{name}`, `{ext}`, `{date}`, `{index}` |
| trash       | bool   | Use trash instead of permanent delete  |

## Database

SQLite via `better-sqlite3`. WAL mode for concurrent reads. Four tables:

- **rules** — serializes conditions/actions as JSON columns
- **activity_log** — timestamped record of every action taken
- **snapshots** — pre-action file state grouped by batch ID for rollback
- **config** — key-value pairs for app settings

The database is optional. Without it, managr still works using in-memory state and JSON file fallback.

## Snapshot / Rollback

Before any destructive action (move, rename, delete), managr:

1. Generates a batch ID for the operation
2. Records each file's original path, hash, and size in the `snapshots` table
3. Executes the action
4. Logs success/failure to `activity_log`

To rollback: retrieve the batch's snapshots and reverse each action (move files back, restore original names). Mark the batch as rolled back.

## File watcher

Uses `chokidar` to monitor directories defined in enabled rules. On file system events:

1. Determine which rules match the event (trigger type + watch path)
2. Evaluate conditions against the file
3. Execute actions for all matching rules, ordered by priority
4. Log results and create snapshots

## MCP tool surface (29 tools)

The MCP server exposes three categories of tools:

**File operations (17):** Direct file management — list, search, move, copy, rename, delete, find duplicates, organize by type, backup, sync directories, disk usage, etc.

**Rules engine (6):** CRUD for automation rules plus manual execution — `create_rule`, `list_rules`, `get_rule`, `update_rule`, `delete_rule`, `run_rule`.

**Activity & control (6):** Observability and undo — `get_activity_log`, `get_snapshots`, `rollback`, `start_watcher`, `stop_watcher`, `watcher_status`.

Database is stored at `~/.managr/managr.db` (created automatically on first run).

## Component library

Themeable React components using CSS modules and CSS custom properties. The `ThemeProvider` injects a palette as `--mgr-*` variables consumed by all component styles.

Built-in palettes: **Ink Wash** (dark) and **Ink Wash Light**. Custom palettes can be injected at runtime via `setTheme(palette)`.
