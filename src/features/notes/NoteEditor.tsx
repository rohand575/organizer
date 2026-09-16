import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { IconButton } from '../../components/IconButton'
import { MicIcon, PinIcon, TrashIcon, XIcon } from '../../components/icons'
import { hasVoiceKeys, transcribe } from '../../lib/stt'
import { polishDictation } from '../../lib/intent'
import { useHoldToTalk } from '../../lib/useHoldToTalk'
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
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [dictation, setDictation] = useState<'idle' | 'working' | 'error'>('idle')

  const commit = () => onSave({ id: note?.id, title, body, color, pinned })

  // Insert dictated text at the caret (or append), fixing up spacing.
  const insertText = (text: string) => {
    setBody((prev) => {
      const ta = bodyRef.current
      const start = ta?.selectionStart ?? prev.length
      const end = ta?.selectionEnd ?? prev.length
      const before = prev.slice(0, start)
      const after = prev.slice(end)
      const lead = before && !/\s$/.test(before) ? ' ' : ''
      const insert = lead + text
      requestAnimationFrame(() => {
        const pos = (before + insert).length
        ta?.focus()
        ta?.setSelectionRange(pos, pos)
      })
      return before + insert + after
    })
  }

  const { recording, bind } = useHoldToTalk({
    disabled: dictation === 'working',
    onResult: async (blob) => {
      setDictation('working')
      try {
        const raw = await transcribe(blob)
        if (raw) {
          const clean = await polishDictation(raw)
          insertText(clean)
        }
        setDictation('idle')
      } catch {
        setDictation('error')
        setTimeout(() => setDictation('idle'), 2500)
      }
    },
    onMicBlocked: () => {
      setDictation('error')
      setTimeout(() => setDictation('idle'), 2500)
    },
  })

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
            ref={bodyRef}
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
          {hasVoiceKeys && (
            <button
              aria-label="Hold to dictate"
              disabled={dictation === 'working'}
              style={{ touchAction: 'none' }}
              {...bind}
              className={`press relative grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
                recording ? 'bg-[#FF375F] text-white' : 'text-subtle hover:text-accent'
              }`}
            >
              {dictation === 'working' ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-hair border-t-accent" />
              ) : (
                <MicIcon className="h-5 w-5" />
              )}
              {recording && <span className="absolute inset-0 animate-ping rounded-full bg-[#FF375F]/25" />}
            </button>
          )}
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
