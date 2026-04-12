/**
 * managr — File watcher service
 *
 * Monitors directories defined in enabled rules and emits events
 * to the rules engine when files are created or modified.
 */

import chokidar, { type FSWatcher } from 'chokidar'
import * as path from 'path'
import type { TriggerType } from './types.js'

export interface WatchEvent {
  type: TriggerType
  filePath: string
  directory: string
  filename: string
}

type EventHandler = (event: WatchEvent) => void

export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map()
  private handlers: EventHandler[] = []
  private running = false

  /** Register a callback for file events. */
  onEvent(handler: EventHandler): void {
    this.handlers.push(handler)
  }

  /** Start watching a set of directories. */
  watch(directories: string[]): void {
    this.running = true
    const unique = [...new Set(directories)]

    for (const dir of unique) {
      if (this.watchers.has(dir)) continue

      const watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
      })

      watcher.on('add', filePath => {
        this.emit({
          type: 'file_created',
          filePath,
          directory: path.dirname(filePath),
          filename: path.basename(filePath),
        })
      })

      watcher.on('change', filePath => {
        this.emit({
          type: 'file_modified',
          filePath,
          directory: path.dirname(filePath),
          filename: path.basename(filePath),
        })
      })

      watcher.on('error', err => {
        console.error(`Watcher error on ${dir}:`, err instanceof Error ? err.message : err)
      })

      this.watchers.set(dir, watcher)
    }
  }

  /** Stop watching specific directories no longer needed. */
  unwatch(directories: string[]): void {
    for (const dir of directories) {
      const watcher = this.watchers.get(dir)
      if (watcher) {
        watcher.close()
        this.watchers.delete(dir)
      }
    }
  }

  /** Reconfigure watched directories based on current enabled rules. */
  sync(activeDirectories: string[]): void {
    const active = new Set(activeDirectories)
    const current = new Set(this.watchers.keys())

    const toAdd = activeDirectories.filter(d => !current.has(d))
    const toRemove = [...current].filter(d => !active.has(d))

    if (toRemove.length > 0) this.unwatch(toRemove)
    if (toAdd.length > 0) this.watch(toAdd)
  }

  /** Stop all watchers. */
  async stop(): Promise<void> {
    this.running = false
    const closers = [...this.watchers.values()].map(w => w.close())
    await Promise.all(closers)
    this.watchers.clear()
  }

  /** Whether the watcher is currently active. */
  isRunning(): boolean {
    return this.running
  }

  /** List of currently watched directories. */
  watchedPaths(): string[] {
    return [...this.watchers.keys()]
  }

  private emit(event: WatchEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch (err) {
        console.error('Watcher handler error:', err)
      }
    }
  }
}
