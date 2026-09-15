import { useState } from 'react'
import { motion } from 'framer-motion'
import { IconButton } from '../../components/IconButton'
import { PinIcon, TrashIcon, XIcon } from '../../components/icons'
import { NOTE_COLORS, type NoteDoc } from './NotesPage'

interface SaveData {
  id?: string
  title: string
  body: string
  color: string
  pinned: boolean
}

export function NoteEditor({
  note,
  onSave,
  onDelete,
}: {
  note: NoteDoc | null
  onSave: (data: SaveData) => void
  onDelete?: () => void
}) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [color, setColor] = useState(note?.color ?? '#FFFFFF')
  const [pinned, setPinned] = useState(note?.pinned ?? false)

  const commit = () => onSave({ id: note?.id, title, body, color, pinned })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={commit}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center"
    >
      <motion.div
        initial={{ y: 40, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: color }}
        className="safe-bottom flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-3xl shadow-float sm:rounded-3xl"
      >
        <div className="flex items-center justify-between px-4 pt-4">
          <IconButton onClick={() => setPinned((p) => !p)} aria-label="Pin">
            <PinIcon className={`h-5 w-5 ${pinned ? 'text-accent' : 'text-subtle'}`} />
          </IconButton>
          <IconButton onClick={commit} aria-label="Close">
            <XIcon className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <input
            autoFocus={!note}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent pb-2 text-xl font-semibold outline-none placeholder:text-ink/30"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Take a note…"
            rows={6}
            className="min-h-[8rem] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-ink/30"
          />
        </div>

        {/* Color palette + delete */}
        <div className="flex items-center gap-2 px-5 pb-5 pt-2">
          <div className="flex flex-1 flex-wrap gap-2">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                style={{ backgroundColor: c }}
                className={`h-7 w-7 rounded-full border transition-transform ${
                  color === c ? 'scale-110 border-accent' : 'border-black/10'
                }`}
              />
            ))}
          </div>
          {onDelete && (
            <IconButton onClick={onDelete} aria-label="Delete note">
              <TrashIcon className="h-5 w-5" />
            </IconButton>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
