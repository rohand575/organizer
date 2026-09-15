import { useState, type FormEvent } from 'react'
import { PlusIcon } from './icons'

/** Inline add input with a leading plus button. */
export function AddBar({
  placeholder,
  onAdd,
  autoFocus,
}: {
  placeholder: string
  onAdd: (text: string) => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }

  return (
    <form onSubmit={submit} className="card flex items-center gap-3 px-4 py-3">
      <span className="text-accent">
        <PlusIcon className="h-5 w-5" />
      </span>
      <input
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[15px] outline-none placeholder:text-subtle/70"
      />
    </form>
  )
}
