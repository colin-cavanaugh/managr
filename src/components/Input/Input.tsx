import { type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import styles from './Input.module.css'

interface InputBaseProps {
  label?: string
  hint?: string
  error?: string
}

interface InputFieldProps extends InputBaseProps, InputHTMLAttributes<HTMLInputElement> {
  multiline?: false
}

interface TextareaProps extends InputBaseProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
  multiline: true
}

type InputProps = InputFieldProps | TextareaProps

export function Input(props: InputProps) {
  const { label, hint, error, multiline, className = '', ...rest } = props
  const wrapperCls = [styles.wrapper, error ? styles.error : '', className].filter(Boolean).join(' ')

  return (
    <div className={wrapperCls}>
      {label && <label className={styles.label}>{label}</label>}
      {multiline ? (
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          className={styles.input}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {error && <span className={styles.errorText}>{error}</span>}
      {!error && hint && <span className={styles.hint}>{hint}</span>}
    </div>
  )
}
