# managr

A cross-platform desktop file management and automation tool. Browse your filesystem with real-time size analysis, filter files by type, and create rules that automatically organize files as they appear — with full snapshot rollback.

## Features

- **Directory Explorer** — browse any drive or folder with live size breakdowns by extension, progressive folder-size loading, and deep recursive scanning
- **Extension identification** — hover any file extension for a plain-English description (300+ extensions covered, from `.ba2` to `.gguf`)
- **Extension filtering** — click an extension to filter the file list; with Deep Scan, folders are included if they contain that type anywhere inside
- **Rule-based automation** — create rules like "move all PDFs from Downloads to Documents/PDFs" that fire automatically via file watcher
- **Snapshot & rollback** — every file operation is recorded; bulk operations can be reversed with one click
- **Pinned & frequent directories** — bookmark folders or surface the most-visited ones automatically
- **Skip folders** — exclude directories from scans, size calculations, and watcher events
- **AI integration** — built-in MCP server lets AI assistants manage files via natural language (29 tools)

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

### Development

```bash
git clone https://github.com/YOUR_USERNAME/managr.git
cd managr
npm install
cd server && npm install && cd ..
npm run build:server
npm run dev
```

Starts both the API server (port 3456) and the React dashboard (port 5173). Vite proxies `/api` to the API server automatically.

### Desktop app (Electron)

```bash
# Development with hot-reload
npm run dev:electron

# Build installer (Windows .exe, Mac .dmg, Linux .AppImage)
npm run build:electron
```

The Electron app bundles the API server internally — no separate terminal needed. Press **F1** or open **Help → User Guide** for the in-app reference.

### MCP server (AI integration)

```bash
cd server && npm run build
```

Add to `.mcp.json`:

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

## Volume loading — Calculate Volume vs Scan All Subfolders

| | Calculate Volume | Scan All Subfolders |
|---|---|---|
| Folder sizes | Top-level subfolders only | All nested folders |
| Extension breakdown | Current folder files only | Entire subtree |
| Folder extension filter | Not available | Available |
| Speed | Fast | Slow on large drives |

Folder sizes are cached for the session — navigating away and back is instant.

## MCP tools (29)

**File operations:** `list_directory`, `find_duplicates`, `organize_by_type`, `bulk_rename`, `get_folder_size`, `find_large_files`, `find_old_files`, `move_files`, `delete_files`, `search_files`, `search_file_contents`, `get_file_info`, `read_text_file`, `get_disk_usage`, `backup_directory`, `sync_directories`, `create_directory`

**Rules engine:** `create_rule`, `list_rules`, `get_rule`, `update_rule`, `delete_rule`, `run_rule`

**Activity & rollback:** `get_activity_log`, `get_snapshots`, `rollback`

**Watcher control:** `start_watcher`, `stop_watcher`, `watcher_status`

## Project structure

```
managr/
  src/                    React dashboard (Vite + TypeScript)
    pages/
      ExplorerPage.tsx    Main file browser — drives, listing, analysis, filtering
      RulesPage.tsx       Rule builder and manager
      ActivityPage.tsx    Operation history
      SnapshotsPage.tsx   Batch rollback
    components/           Themeable component library (CSS modules)
    data/
      extensionDescriptions.ts   300+ extension → plain-English description
  electron/
    main.cjs              Electron main — window, API fork, Help menu
    help.html             In-app User Guide (Help → User Guide / F1)
  server/
    src/
      api.ts              Express API server (port 3456)
      database.ts         SQLite persistence (rules, activity, snapshots, dirs)
      engine.ts           Rules engine — condition eval, action execution
      watcher.ts          chokidar file watcher
    index.ts              MCP server entry point
  PRODUCT_OVERVIEW.md     Full feature reference
```

## How rules work

1. **Trigger** — file created, file modified, or manual
2. **Conditions** — extension, name pattern, size, age
3. **Actions** — move, copy, rename, delete, back up

Example: *"When a `.png` appears in Downloads larger than 5 MB, move it to Pictures/Screenshots."*

## License

MIT
