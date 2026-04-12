import { type SelectHTMLAttributes } from 'react'
import styles from './Select.module.css'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  options: SelectOption[]
  placeholder?: string
}

export function Select({ label, hint, options, placeholder, className = '', ...rest }: SelectProps) {
  const wrapperCls = [styles.wrapper, className].filter(Boolean).join(' ')

  return (
    <div className={wrapperCls}>
      {label && <label className={styles.label}>{label}</label>}
      <select className={styles.select} {...rest}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  )
}
