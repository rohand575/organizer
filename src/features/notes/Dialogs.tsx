import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useVisualViewport } from '../../lib/useVisualViewport'

/** Small centered dialog that floats above the note editor (z-50). */
function DialogFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const vv = useVisualViewport()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Stop here: the dialog can sit inside the note editor, whose backdrop
      // click closes the editor.
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      style={{ top: vv.offsetTop, height: vv.height }}
      className="fixed left-0 right-0 z-[60] flex items-center justify-center bg-black/30 px-6 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-surface p-5 shadow-float"
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

function Actions({
  confirmLabel,
  destructive,
  disabled,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string
  destructive?: boolean
  disabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="press rounded-full px-4 py-2 text-[15px] font-medium text-subtle hover:bg-black/5">
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className={`press rounded-full px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-40 ${
          destructive ? 'bg-[#FF3B30]' : 'bg-accent'
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  )
}

export function NameDialog({
  title,
  initial = '',
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string
  initial?: string
  confirmLabel: string
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const clean = name.trim()
  const submit = () => {
    if (!clean) return
    onSubmit(clean)
    onClose()
  }
  return (
    <DialogFrame onClose={onClose}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <input
        autoFocus
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Folder name"
        className="mt-3 w-full rounded-xl bg-black/[0.05] px-3.5 py-2.5 text-[15px] outline-none placeholder:text-subtle focus:bg-black/[0.07]"
      />
      <Actions confirmLabel={confirmLabel} disabled={!clean} onCancel={onClose} onConfirm={submit} />
    </DialogFrame>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <DialogFrame onClose={onClose}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-[15px] text-subtle">{message}</p>
      <Actions
        confirmLabel={confirmLabel}
        destructive
        onCancel={onClose}
        onConfirm={() => {
          onConfirm()
          onClose()
        }}
      />
    </DialogFrame>
  )
}
