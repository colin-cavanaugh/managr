# managr — Product Overview

managr is a cross-platform desktop file management and automation tool. It gives you a real-time view of what's inside your directories, how much space everything occupies, and lets you set up rules to automatically organize files as they appear.

---

## What It Does

### Directory Explorer

Browse any folder on your machine — local drives, mounted network shares, or WSL paths — and immediately see:

- **File type breakdown** — a ranked list of every extension present, with a size bar showing relative footprint
- **Folder sizes** — how much space each subfolder actually consumes, loaded progressively in the background
- **Stats bar** — total file count, folder count, and aggregate size at a glance

You can sort contents by name, size, modified date, accessed date, or type. Multi-select files or folders for bulk move or delete operations.

### Extension Tooltips

Hover over any extension in the File Types panel to see a plain-English description — e.g. hovering `.ba2` shows *Bethesda Archive 2 — game data for Fallout 4, Starfield*. This covers 300+ extensions across documents, images, video, audio, archives, code, game files, ML models, and more.

### Extension Filtering

Click any extension in the File Types panel to filter the Contents panel to only show matching items. The active filter appears as a pill in the header — e.g. `.ba2 — Bethesda Archive 2 ×`. Click the pill or the extension again to clear it.

- **Without Deep Scan**: only files with that extension are shown; folders are hidden because their contents aren't known yet
- **With Deep Scan**: folders are also shown if they contain at least one file of that type anywhere inside them

### Volume Loading (Calculate Volume)

Folder sizes are loaded lazily — one folder at a time in the background — so the UI stays responsive. At drive roots (e.g. `C:\`, `/mnt/c`) this is paused by default and requires a manual click to start.

You can **Pause Volume** at any time from the sort bar. If you've already loaded some sizes, resuming picks up where it left off and skips already-cached folders.

Folder sizes are cached for the entire session, so navigating away and back to a directory is instant.

### Deep Scan (Scan All Subfolders)

**Calculate Volume** loads the direct size of each top-level subfolder.

**Scan All Subfolders** recurses into every subdirectory and collects:
- The total size of every nested folder (all go into the session cache)
- Which extensions exist inside each subfolder (enables folder filtering by type)
- An accurate aggregate breakdown across the entire tree

Deep scan is more expensive — on large directories it can take several minutes — but it gives you a complete picture. You can stop it at any time from the **Stop Deep Scan** button that appears during the scan.

| | Calculate Volume | Scan All Subfolders |
|---|---|---|
| Folder sizes | Top-level subfolders only | All nested folders |
| Extension breakdown | Current folder files only | Entire subtree |
| Folder filtering | Not available | Available |
| Speed | Fast | Slow on large drives |

### Search

- **Filter by name** — instantly filters visible items by filename (no server call)
- **Deep search** — sends a recursive server-side search, returning results from all subdirectories with debounce

### Automation Rules

Create rules that watch a directory and automatically move, copy, rename, or delete files when they match conditions (extension, size, name pattern). Rules can be triggered on file creation, modification, or run manually.

The **+ Rule** button on any extension row in the breakdown panel opens a quick-rule dialog pre-filled for that extension.

### Activity Log & Snapshots

Every file operation (move, rename, delete, rule action) is logged in the Activity page. Bulk operations create a snapshot batch that can be rolled back in one click from the Snapshots page — files are moved back to their original locations.

### Pinned & Frequent Directories

- **Pinned** — manually bookmark directories for quick access from the sidebar
- **Frequent** — the four most-visited directories are automatically surfaced in the sidebar

### Skip Folders

Mark any directory as skipped. Skipped directories are excluded from size calculations, deep scans, and watcher events. Useful for virtual filesystems, network shares, or system folders you don't want to include.

---

## Keyboard / UI Quick Reference

| Action | How |
|---|---|
| Navigate into folder | Click folder name or icon |
| Go up one level | Click `..` row (pinned to top of contents) |
| Filter by extension | Click extension in File Types panel |
| Clear extension filter | Click the pill in the Contents header |
| See extension description | Hover over extension in File Types panel |
| Select multiple files | Click checkboxes; Shift+click for range |
| Quick rule for extension | Click `+ Rule` in File Types row |
| Pin current directory | Click pin icon in sidebar |
| Skip a folder | Click `⊘` in the folder's action row |

---

## Architecture

managr runs as an Electron desktop app. The React UI communicates with a local Express API server (port 3456) that handles all filesystem operations. An SQLite database (via `better-sqlite3`) stores rules, activity logs, snapshots, pinned directories, frequent directory visits, and the skip list. A `chokidar` file watcher fires automation rules in real time.
