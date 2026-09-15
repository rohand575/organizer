import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function IconButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={`press grid h-9 w-9 place-items-center rounded-full text-subtle transition-colors hover:bg-black/5 active:bg-black/10 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
