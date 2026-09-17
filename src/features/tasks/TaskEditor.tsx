import { useState } from 'react'
import { motion } from 'framer-motion'
import { IconButton } from '../../components/IconButton'
import { CalendarIcon, ClockIcon, TrashIcon, XIcon } from '../../components/icons'
import { createEvent, deleteEvent, isCalendarConnected, updateEvent } from '../../lib/calendar'
import { calendarColorId, REMINDER_DURATION_MIN, TASK_COLORS } from '../../lib/commands'
import { useVisualViewport } from '../../lib/useVisualViewport'
import type { Task } from './TasksPage'

// Firestore stores remindAt as a local ISO string (YYYY-MM-DDTHH:MM:SS).
// <input type="datetime-local"> wants YYYY-MM-DDTHH:MM.
const toInput = (iso?: string | null) => (iso ? iso.slice(0, 16) : '')
const toStored = (value: string) => (value.length === 16 ? `${value}:00` : value)

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

export function TaskEditor({
  task,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: Task
  onClose: () => void
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onDelete: () => void
}) {
  const [text, setText] = useState(task.text)
  const [color, setColor] = useState(task.color ?? TASK_COLORS[0])
  const [remindOn, setRemindOn] = useState(Boolean(task.remindAt))
  const [when, setWhen] = useState(toInput(task.remindAt))
  const [saving, setSaving] = useState(false)
  const vv = useVisualViewport()

  const save = async () => {
    if (saving) return
    setSaving(true)
    const trimmed = text.trim() || task.text
    const remindAt = remindOn && when ? toStored(when) : null
    let calendarEventId = task.calendarEventId ?? null

    if (isCalendarConnected()) {
      try {
        if (remindAt) {
          const payload = {
            summary: trimmed,
            startISO: remindAt,
            durationMin: REMINDER_DURATION_MIN,
            timeZone: TZ,
            colorId: calendarColorId(color),
          }
          if (calendarEventId) {
            const ok = await updateEvent(calendarEventId, payload)
            if (!ok) calendarEventId = await createEvent(payload)
          } else {
            calendarEventId = await createEvent(payload)
          }
        } else if (calendarEventId) {
          await deleteEvent(calendarEventId)
          calendarEventId = null
        }
      } catch {
        // Non-fatal — save the task regardless of calendar sync.
      }
    }

    await onUpdate(task.id, { text: trimmed, color, remindAt, calendarEventId })
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={save}
      style={{ top: vv.offsetTop, height: vv.height }}
      className="fixed left-0 right-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center"
    >
      <motion.div
        initial={{ y: 40, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: vv.height }}
        className="safe-bottom flex w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-surface shadow-float sm:rounded-3xl"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Edit task</span>
          <IconButton onClick={save} aria-label="Close">
            <XIcon className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="px-5 pt-2">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Task"
            className="w-full bg-transparent pb-3 text-lg font-medium outline-none placeholder:text-ink/30"
          />
        </div>

        {/* Reminder */}
        <div className="px-5">
          <div className="flex items-center gap-3 border-t border-hair py-3">
            <ClockIcon className="h-5 w-5 text-subtle" />
            <span className="flex-1 text-[15px]">Reminder</span>
            <button
              onClick={() => setRemindOn((v) => !v)}
              aria-label="Toggle reminder"
              className={`relative h-6 w-10 rounded-full transition-colors ${
                remindOn ? 'bg-accent' : 'bg-hair'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  remindOn ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          {remindOn && (
            <div className="pb-1">
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="w-full rounded-xl border border-hair bg-canvas px-3 py-2.5 text-[15px] outline-none focus:border-accent"
              />
              <div className="flex items-center gap-1.5 px-1 pt-1.5 text-xs text-subtle">
                <CalendarIcon className="h-3.5 w-3.5" />
                {isCalendarConnected()
                  ? `Adds a ${REMINDER_DURATION_MIN}-min Google Calendar event`
                  : 'Connect Google Calendar in Settings to sync events'}
              </div>
            </div>
          )}
        </div>

        {/* Color + delete */}
        <div className="flex items-center gap-2 px-5 pb-6 pt-4">
          <div className="flex flex-1 flex-wrap gap-2">
            {TASK_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                style={{ backgroundColor: c }}
                className={`h-7 w-7 rounded-full border transition-transform ${
                  color === c ? 'scale-110 border-ink' : 'border-black/10'
                }`}
              />
            ))}
          </div>
          <IconButton onClick={onDelete} aria-label="Delete task">
            <TrashIcon className="h-5 w-5" />
          </IconButton>
        </div>
      </motion.div>
    </motion.div>
  )
}
