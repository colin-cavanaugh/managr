import { useState, useEffect } from 'react'
import { Badge, Button, Modal } from '../components'
import { api, type SnapshotBatch, type SnapshotFile } from '../api/client'
import styles from './SnapshotsPage.module.css'

const ACTION_LABELS: Record<string, string> = {
  move: 'Move',
  copy: 'Copy',
  rename: 'Rename',
  delete: 'Delete',
  backup: 'Backup',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function SnapshotsPage() {
  const [batches, setBatches] = useState<SnapshotBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<SnapshotFile[]>([])
  const [rollbackTarget, setRollbackTarget] = useState<SnapshotBatch | null>(null)

  const fetchBatches = async () => {
    try {
      const result = await api.snapshots.list()
      setBatches(result.batches)
    } catch {
      // empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBatches() }, [])

  const toggleExpand = async (batchId: string) => {
    if (expandedId === batchId) {
      setExpandedId(null)
      return
    }
    try {
      const result = await api.snapshots.getFiles(batchId)
      setExpandedFiles(result.files)
      setExpandedId(batchId)
    } catch {
      // skip
    }
  }

  const handleRollback = async (batch: SnapshotBatch) => {
    try {
      await api.snapshots.rollback(batch.batchId)
      setRollbackTarget(null)
      fetchBatches()
    } catch {
      // skip
    }
  }

  if (loading) return <div style={{ color: 'var(--mgr-text-muted)', padding: 32 }}>Loading snapshots...</div>

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.count}>{batches.length} snapshot batch{batches.length !== 1 ? 'es' : ''}</span>
      </div>

      {batches.length === 0 ? (
        <div className={styles.empty}>No snapshots yet. Snapshots are created automatically when rules execute file operations.</div>
      ) : (
        <div className={styles.list}>
          {batches.map(batch => (
            <div key={batch.batchId} className={styles.batch}>
              <div className={styles.batchHeader} onClick={() => toggleExpand(batch.batchId)}>
                <div className={styles.batchInfo}>
                  <Badge variant="primary">
                    {ACTION_LABELS[batch.action] ?? batch.action}
                  </Badge>
                  <span className={styles.batchTitle}>
                    {batch.fileCount} file{batch.fileCount !== 1 ? 's' : ''}
                  </span>
                  <span className={styles.batchTime}>{formatDate(batch.createdAt)}</span>
                </div>
                <div className={styles.batchActions}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={e => { e.stopPropagation(); setRollbackTarget(batch) }}
                  >
                    Rollback
                  </Button>
                </div>
              </div>

              {expandedId === batch.batchId && expandedFiles.length > 0 && (
                <ul className={styles.fileList}>
                  {expandedFiles.map(file => (
                    <li key={file.id} className={styles.fileItem}>
                      <span className={styles.filePath}>{file.originalPath}</span>
                      {file.newPath && (
                        <>
                          <span className={styles.fileArrow}>→</span>
                          <span className={styles.filePath}>{file.newPath}</span>
                        </>
                      )}
                      {file.rolledBack && <Badge variant="ghost">restored</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={rollbackTarget !== null}
        onClose={() => setRollbackTarget(null)}
        title="Confirm Rollback"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRollbackTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => rollbackTarget && handleRollback(rollbackTarget)}>
              Rollback {rollbackTarget?.fileCount} files
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--mgr-text)' }}>
          This will restore {rollbackTarget?.fileCount} file{(rollbackTarget?.fileCount ?? 0) !== 1 ? 's' : ''} to
          their original locations. The {rollbackTarget?.action} operations will be reversed.
        </p>
      </Modal>
    </div>
  )
}
