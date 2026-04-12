# managr

A cross-platform file automation tool. Define rules to automatically organize, move, rename, back up, and clean up files on your computer — with full undo support.

## What it does

- **Rule-based automation** — Create rules like "move all PDFs from Downloads to Documents/PDFs" and managr handles it automatically
- **File watcher** — Monitors your directories in real time and triggers rules when files appear or change
- **Snapshot & rollback** — Every action is recorded. Changed your mind? Undo any operation with one click
- **Storage insights** — Find duplicates, large files, and old files eating up your disk space
- **Dashboard** — Visual interface to manage rules, view activity, and monitor your file system
- **AI-powered** — Built-in MCP server lets AI assistants help you manage files using natural language

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

### Install and run

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/managr.git
cd managr

# Install dependencies
npm install
cd server && npm install && cd ..

# Build the server
npm run build:server

# Start everything (API + dashboard in one command)
npm run dev
```

This starts both the API server (port 3456) and the dashboard (port 5173) in a single terminal. Ctrl+C stops both. The Vite dev server automatically proxies `/api` requests to the API server.

### Run as a desktop app (Electron)

```bash
# Development mode (hot-reload)
npm run dev:electron

# Build installer (Windows .exe, Mac .dmg, Linux .AppImage)
npm run build:electron
```

The desktop app runs the API server internally — no separate terminal needed. On Windows, filesystem access is native and significantly faster than through WSL.

### Using the MCP server (AI integration)

managr includes an MCP server that lets AI assistants (like Claude) manage your files. To connect it:

1. Build the server: `cd server && npm run build`
2. Add to your `.mcp.json`:
```json
{
  "mcpServers": {
    "file-manager": {
      "command": "node",
      "args": ["<path-to-managr>/server/dist/index.js"]
    }
  }
}
```

## Available tools (29)

**File operations:** list_directory, find_duplicates, organize_by_type, bulk_rename, get_folder_size, find_large_files, find_old_files, move_files, delete_files, search_files, search_file_contents, get_file_info, read_text_file, get_disk_usage, backup_directory, sync_directories, create_directory

**Rules engine:** create_rule, list_rules, get_rule, update_rule, delete_rule, run_rule

**Activity & rollback:** get_activity_log, get_snapshots, rollback

**Watcher control:** start_watcher, stop_watcher, watcher_status

## Project structure

```
managr/
  src/                  React dashboard (Vite + TypeScript)
    components/         Themeable component library (CSS modules)
      theme/            ThemeProvider, palettes (dark/light)
      Button/           Variant, size, fullWidth
      Input/            Label, hint, error, multiline
      Card/             Title, actions, footer, compact
      Badge/            Variant, dot indicator
      Toggle/           Accessible switch
      Modal/            Overlay, ESC-to-close
      Select/           Label, hint, placeholder
  server/
    index.ts            MCP server — 29 tools for file ops + rules engine
    src/
      types.ts          Core data models (rules, snapshots, activity log)
      database.ts       SQLite persistence layer (better-sqlite3)
      engine.ts         Rules engine — condition eval, action exec, rollback
      watcher.ts        chokidar file watcher with directory sync
  docs/                 Architecture and design documents
```

## How rules work

A rule has three parts:

1. **Trigger** — What starts it: a new file appears, a file changes, a schedule, or manual
2. **Conditions** — What must be true: file type, name pattern, size, age
3. **Actions** — What to do: move, copy, rename, delete, organize, or back up

Example rule:
> "When a `.png` file appears in my Downloads folder that's larger than 5MB, move it to Pictures/Screenshots and rename it with today's date."

## License

MIT
