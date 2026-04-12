import { useState, useEffect } from 'react'
import { Button, Input, Select, Badge, Toggle, Modal } from '../components'
import { api, type Rule, type RuleCondition, type RuleAction } from '../api/client'
import styles from './RulesPage.module.css'

const TRIGGER_OPTIONS = [
  { value: 'file_created', label: 'File created' },
  { value: 'file_modified', label: 'File modified' },
  { value: 'schedule', label: 'On schedule' },
  { value: 'manual', label: 'Manual' },
]

const CONDITION_FIELDS = [
  { value: 'extension', label: 'File extension' },
  { value: 'name_pattern', label: 'Name pattern' },
  { value: 'size_gt', label: 'Size greater than' },
  { value: 'size_lt', label: 'Size less than' },
  { value: 'older_than_days', label: 'Older than (days)' },
  { value: 'newer_than_days', label: 'Newer than (days)' },
]

const OPERATOR_OPTIONS = [
  { value: 'equals', label: 'Equals' },
  { value: 'matches', label: 'Matches (glob)' },
  { value: 'contains', label: 'Contains' },
]

const ACTION_TYPES = [
  { value: 'move', label: 'Move' },
  { value: 'copy', label: 'Copy' },
  { value: 'rename', label: 'Rename' },
  { value: 'delete', label: 'Delete' },
  { value: 'backup', label: 'Backup' },
]

const TRIGGER_LABELS: Record<string, string> = {
  file_created: 'On create',
  file_modified: 'On modify',
  schedule: 'Scheduled',
  manual: 'Manual',
}

export function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTrigger, setFormTrigger] = useState('file_created')
  const [formWatchPath, setFormWatchPath] = useState('')
  const [formConditions, setFormConditions] = useState<RuleCondition[]>([{ field: 'extension', operator: 'equals', value: '' }])
  const [formActions, setFormActions] = useState<RuleAction[]>([{ type: 'move', destination: '' }])

  const fetchRules = async () => {
    try {
      const result = await api.rules.list()
      setRules(result.rules)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRules() }, [])

  const resetForm = () => {
    setFormName('')
    setFormDesc('')
    setFormTrigger('file_created')
    setFormWatchPath('')
    setFormConditions([{ field: 'extension', operator: 'equals', value: '' }])
    setFormActions([{ type: 'move', destination: '' }])
    setEditingId(null)
    setShowForm(false)
  }

  const openEdit = (rule: Rule) => {
    setFormName(rule.name)
    setFormDesc(rule.description ?? '')
    setFormTrigger(rule.trigger)
    setFormWatchPath(rule.watchPaths[0] ?? '')
    setFormConditions(rule.conditions.length > 0 ? rule.conditions : [{ field: 'extension', operator: 'equals', value: '' }])
    setFormActions(rule.actions.length > 0 ? rule.actions : [{ type: 'move', destination: '' }])
    setEditingId(rule.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    try {
      if (editingId) {
        await api.rules.update(editingId, {
          name: formName, description: formDesc, trigger: formTrigger,
          watchPaths: [formWatchPath], conditions: formConditions, actions: formActions,
        })
      } else {
        await api.rules.create({
          name: formName, description: formDesc, enabled: true,
          trigger: formTrigger, watchPaths: [formWatchPath],
          conditions: formConditions, actions: formActions, priority: 100,
        })
      }
      resetForm()
      fetchRules()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleRule = async (rule: Rule) => {
    await api.rules.update(rule.id, { enabled: !rule.enabled })
    fetchRules()
  }

  const deleteRule = async (id: string) => {
    await api.rules.delete(id)
    fetchRules()
  }

  const runRule = async (id: string) => {
    try {
      const result = await api.rules.run(id)
      alert(`Processed ${result.processed} files, ${result.errors} errors`)
      fetchRules()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const updateCondition = (idx: number, field: string, value: string) => {
    setFormConditions(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c))
  }

  const updateAction = (idx: number, field: string, value: string) => {
    setFormActions(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a))
  }

  if (loading) return <div style={{ color: 'var(--mgr-text-muted)', padding: 32 }}>Loading rules...</div>

  return (
    <div className={styles.page}>
      {error && <div style={{ color: 'var(--mgr-danger)', fontSize: 13, padding: '8px 12px', background: 'rgba(184,92,92,0.1)', borderRadius: 6 }}>{error}</div>}

      <div className={styles.toolbar}>
        <span className={styles.count}>{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
        <Button onClick={() => { resetForm(); setShowForm(true) }}>+ New Rule</Button>
      </div>

      {rules.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No rules yet</p>
          <p className={styles.emptyDesc}>Create your first automation rule, or use the Explorer to analyze a directory and create rules from there.</p>
          <Button onClick={() => setShowForm(true)}>+ New Rule</Button>
        </div>
      ) : (
        <div className={styles.ruleList}>
          {rules.map(rule => (
            <div key={rule.id} className={styles.ruleCard}>
              <Toggle checked={rule.enabled} onChange={() => toggleRule(rule)} />
              <div className={styles.ruleInfo}>
                <p className={styles.ruleName}>{rule.name}</p>
                {rule.description && <p className={styles.ruleDesc}>{rule.description}</p>}
                <div className={styles.ruleMeta}>
                  <Badge variant={rule.enabled ? 'success' : 'ghost'} dot>
                    {rule.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                  <Badge variant="info">{TRIGGER_LABELS[rule.trigger] ?? rule.trigger}</Badge>
                  {rule.conditions.map((c, i) => (
                    <Badge key={i} variant="ghost">{c.field}: {String(c.value)}</Badge>
                  ))}
                  {rule.actions.map((a, i) => (
                    <Badge key={i} variant="secondary">{a.type}</Badge>
                  ))}
                </div>
              </div>
              <div className={styles.ruleActions}>
                <Button variant="ghost" size="sm" onClick={() => runRule(rule.id)}>Run</Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => deleteRule(rule.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={resetForm}
        title={editingId ? 'Edit Rule' : 'New Rule'}
        footer={
          <>
            <Button variant="ghost" onClick={resetForm}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formName || !formWatchPath}>
              {editingId ? 'Save Changes' : 'Create Rule'}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <Input label="Rule name" placeholder="e.g. Organize Downloads" value={formName} onChange={e => setFormName(e.target.value)} />
          <Input label="Description" placeholder="What this rule does..." value={formDesc} onChange={e => setFormDesc(e.target.value)} />
          <div className={styles.formRow}>
            <Select label="Trigger" options={TRIGGER_OPTIONS} value={formTrigger} onChange={e => setFormTrigger(e.target.value)} />
            <Input label="Watch directory" placeholder="/home/user/Downloads" value={formWatchPath} onChange={e => setFormWatchPath(e.target.value)} />
          </div>

          <p className={styles.formSection}>Conditions</p>
          {formConditions.map((cond, idx) => (
            <div key={idx} className={styles.conditionRow}>
              <Select options={CONDITION_FIELDS} value={cond.field} onChange={e => updateCondition(idx, 'field', e.target.value)} />
              <Select options={OPERATOR_OPTIONS} value={cond.operator} onChange={e => updateCondition(idx, 'operator', e.target.value)} />
              <Input placeholder="Value" value={String(cond.value)} onChange={e => updateCondition(idx, 'value', e.target.value)} />
              {formConditions.length > 1 && (
                <button className={styles.removeBtn} onClick={() => setFormConditions(prev => prev.filter((_, i) => i !== idx))}>×</button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setFormConditions(prev => [...prev, { field: 'extension', operator: 'equals', value: '' }])}>
            + Add condition
          </Button>

          <p className={styles.formSection}>Actions</p>
          {formActions.map((action, idx) => (
            <div key={idx} className={styles.actionRow}>
              <Select options={ACTION_TYPES} value={action.type} onChange={e => updateAction(idx, 'type', e.target.value)} />
              {(action.type === 'move' || action.type === 'copy' || action.type === 'backup') && (
                <Input placeholder="Destination path" value={action.destination ?? ''} onChange={e => updateAction(idx, 'destination', e.target.value)} />
              )}
              {action.type === 'rename' && (
                <Input placeholder="{name}_{date}{ext}" value={action.pattern ?? ''} onChange={e => updateAction(idx, 'pattern', e.target.value)} />
              )}
              {formActions.length > 1 && (
                <button className={styles.removeBtn} onClick={() => setFormActions(prev => prev.filter((_, i) => i !== idx))}>×</button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setFormActions(prev => [...prev, { type: 'move', destination: '' }])}>
            + Add action
          </Button>
        </div>
      </Modal>
    </div>
  )
}
