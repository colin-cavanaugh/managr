import styles from './Toggle.module.css'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

export function Toggle({ checked, onChange, label, disabled = false, className = '' }: ToggleProps) {
  const wrapperCls = [styles.wrapper, disabled ? styles.disabled : '', className].filter(Boolean).join(' ')
  const trackCls = [styles.track, checked ? styles.on : ''].filter(Boolean).join(' ')

  return (
    <label className={wrapperCls}>
      <input
        type="checkbox"
        className={styles.hidden}
        checked={checked}
        onChange={e => !disabled && onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className={trackCls}>
        <span className={styles.thumb} />
      </span>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  )
}
