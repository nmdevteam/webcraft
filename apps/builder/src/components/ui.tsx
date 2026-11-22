import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; busy?: boolean }
export function Button({ variant = 'secondary', size = 'md', busy, className = '', children, disabled, ...props }: ButtonProps) {
  return <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || busy} {...props}>{busy ? <LoaderCircle size={16} className="spin" /> : null}{children}</button>
}
export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`input ${props.className ?? ''}`} /> }
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{children}</section> }
export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'error' }) { return <span className={`status status-${tone}`}>{children}</span> }
