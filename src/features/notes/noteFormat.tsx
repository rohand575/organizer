/**
 * Light formatting for note bodies. The body stays plain text in Firestore (so
 * voice, search and older clients keep working); these conventions are only
 * rendered on display:
 *   - [ ] todo / - [x] done   → tickable checkbox
 *   - item, * item, • item    → bullet
 *   1. item, 1) item          → numbered
 *   # Heading, ## Subheading
 *   **bold**, and bare URLs become links
 * Every rendered text span carries its source offset (data-o) so tapping the
 * rendered view can drop the caret at the same spot in the textarea.
 */
import type { ReactNode } from 'react'
import { Checkbox } from '../../components/Checkbox'

const CHECK_RE = /^(\s*)(?:[-*•]\s+)?\[([ xX])\]\s?/
const BULLET_RE = /^(\s*)([-*•])\s+/
const NUMBER_RE = /^(\s*)(\d{1,3})([.)])\s+/
const HEADING_RE = /^(#{1,3})\s+/

type Kind = 'check' | 'bullet' | 'number' | 'heading' | 'text' | 'blank'

export interface Line {
  kind: Kind
  /** Nesting level from leading whitespace (2 spaces or a tab per level). */
  indent: number
  /** Absolute offset of the line start in the body. */
  start: number
  /** Absolute offset where the line's content (after its marker) starts. */
  textStart: number
  /** Absolute offset of the line end (before the newline). */
  end: number
  text: string
  checked?: boolean
  marker?: string
  level?: number
}

function indentOf(ws: string): number {
  return Math.min(4, Math.floor(ws.replace(/\t/g, '  ').length / 2))
}

export function parseBody(body: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (const raw of body.split('\n')) {
    const end = start + raw.length
    const base = { start, end }
    let m: RegExpMatchArray | null
    if (!raw.trim()) {
      lines.push({ ...base, kind: 'blank', indent: 0, textStart: end, text: '' })
    } else if ((m = raw.match(CHECK_RE))) {
      lines.push({
        ...base,
        kind: 'check',
        indent: indentOf(m[1]),
        textStart: start + m[0].length,
        text: raw.slice(m[0].length),
        checked: m[2] !== ' ',
      })
    } else if ((m = raw.match(BULLET_RE))) {
      lines.push({ ...base, kind: 'bullet', indent: indentOf(m[1]), textStart: start + m[0].length, text: raw.slice(m[0].length) })
    } else if ((m = raw.match(NUMBER_RE))) {
      lines.push({
        ...base,
        kind: 'number',
        indent: indentOf(m[1]),
        textStart: start + m[0].length,
        text: raw.slice(m[0].length),
        marker: m[2] + m[3],
      })
    } else if ((m = raw.match(HEADING_RE))) {
      lines.push({ ...base, kind: 'heading', indent: 0, textStart: start + m[0].length, text: raw.slice(m[0].length), level: m[1].length })
    } else {
      lines.push({ ...base, kind: 'text', indent: 0, textStart: start, text: raw })
    }
    start = end + 1
  }
  return lines
}

/** Flip the checkbox on line `index`. */
export function toggleCheck(body: string, index: number): string {
  const lines = body.split('\n')
  const m = lines[index]?.match(CHECK_RE)
  if (!m) return body
  const at = m[0].indexOf('[') + 1
  const line = lines[index]
  lines[index] = line.slice(0, at) + (m[2] === ' ' ? 'x' : ' ') + line.slice(at + 1)
  return lines.join('\n')
}

// --- Inline: **bold** and links ---------------------------------------------

const INLINE_RE = /\*\*([^*]+?)\*\*|((?:https?:\/\/|www\.)[^\s<>"]+)/g

function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"]+$/, '')
  // Keep a closing paren only if the URL opened one (e.g. Wikipedia links).
  while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1)
  return u
}

function renderInline(text: string, base: number): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  const plain = (from: number, to: number) => {
    if (to > from) out.push(<span key={`t${from}`} data-o={base + from}>{text.slice(from, to)}</span>)
  }
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0
    plain(last, at)
    if (m[1] != null) {
      out.push(<strong key={`b${at}`} data-o={base + at + 2} className="font-semibold">{m[1]}</strong>)
      last = at + m[0].length
    } else {
      const url = trimUrl(m[2])
      out.push(
        <a
          key={`a${at}`}
          data-o={base + at}
          href={url.startsWith('www.') ? `https://${url}` : url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="break-all text-accent underline decoration-accent/40 underline-offset-2"
        >
          {url}
        </a>,
      )
      last = at + url.length
    }
  }
  plain(last, text.length)
  return out
}

// --- Rendering ---------------------------------------------------------------

export function NoteBody({
  body,
  compact = false,
  maxLines,
  onToggle,
}: {
  body: string
  compact?: boolean
  /** Render at most this many lines (cards only show the top of a note). */
  maxLines?: number
  onToggle?: (lineIndex: number) => void
}) {
  let lines = parseBody(body)
  while (lines.length && lines[lines.length - 1].kind === 'blank') lines.pop()
  if (maxLines) lines = lines.slice(0, maxLines)

  const size = compact ? 'text-[13.5px] leading-relaxed text-ink/80' : 'text-[15px] leading-relaxed text-ink'

  return (
    <div className={size}>
      {lines.map((line, i) => {
        const pad = line.indent ? { paddingLeft: `${line.indent * 1.25}rem` } : undefined
        const common = { 'data-start': line.textStart, 'data-end': line.end } as Record<string, number>
        switch (line.kind) {
          case 'blank':
            return <div key={i} {...common} className={compact ? 'h-2' : 'h-[1.6em]'} />
          case 'check':
            return (
              <div key={i} {...common} style={pad} className="flex items-start gap-2 py-0.5">
                <span data-m className="pt-px" onClick={(e) => e.stopPropagation()}>
                  <Checkbox size="sm" checked={Boolean(line.checked)} onChange={() => onToggle?.(i)} />
                </span>
                <span className={`min-w-0 flex-1 break-words ${line.checked ? 'text-subtle line-through' : ''}`}>
                  {renderInline(line.text, line.textStart)}
                </span>
              </div>
            )
          case 'bullet':
          case 'number':
            return (
              <div key={i} {...common} style={pad} className="flex items-start gap-1.5">
                <span data-m className={`shrink-0 text-subtle ${line.kind === 'bullet' ? 'w-3 text-center' : 'tabular-nums'}`}>
                  {line.kind === 'bullet' ? '•' : line.marker}
                </span>
                <span className="min-w-0 flex-1 break-words">{renderInline(line.text, line.textStart)}</span>
              </div>
            )
          case 'heading':
            return (
              <div
                key={i}
                {...common}
                className={`break-words font-semibold text-ink ${
                  line.level === 1 ? (compact ? 'text-[15px]' : 'text-lg') : compact ? '' : 'text-base'
                } ${i > 0 ? 'pt-1' : ''}`}
              >
                {renderInline(line.text, line.textStart)}
              </div>
            )
          default:
            return (
              <div key={i} {...common} className="whitespace-pre-wrap break-words">
                {renderInline(line.text, line.textStart)}
              </div>
            )
        }
      })}
    </div>
  )
}

// --- Tap-to-edit caret mapping ----------------------------------------------

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  return null
}

/** Map a tap on the rendered body to an offset in the source text. */
export function sourceOffsetAt(x: number, y: number, target: Element, root: Element, fallback: number): number {
  const marker = target.closest('[data-m]')
  const line = target.closest('[data-end]')
  if (marker && line && root.contains(line)) return Number((line as HTMLElement).dataset.start)
  const hit = caretAt(x, y)
  if (hit && hit.node.nodeType === Node.TEXT_NODE) {
    const span = hit.node.parentElement?.closest('[data-o]') as HTMLElement | null
    if (span && root.contains(span)) return Number(span.dataset.o) + hit.offset
  }
  if (line && root.contains(line)) return Number((line as HTMLElement).dataset.end)
  return fallback
}

// --- Editing helpers ---------------------------------------------------------

function listPrefix(line: string): { indent: string; marker: string; rest: string } | null {
  let m = line.match(CHECK_RE)
  if (m) return { indent: m[1], marker: m[0].slice(m[1].length), rest: line.slice(m[0].length) }
  m = line.match(BULLET_RE)
  if (m) return { indent: m[1], marker: m[0].slice(m[1].length), rest: line.slice(m[0].length) }
  m = line.match(NUMBER_RE)
  if (m) return { indent: m[1], marker: m[0].slice(m[1].length), rest: line.slice(m[0].length) }
  return null
}

export interface Edit {
  body: string
  selStart: number
  selEnd: number
}

/**
 * Toolbar action: turn the selected lines into checklist items or bullets — or
 * back into plain text if they all already are.
 */
export function toggleLines(body: string, selStart: number, selEnd: number, kind: 'check' | 'bullet'): Edit {
  const lines = body.split('\n')
  const starts: number[] = []
  let acc = 0
  for (const l of lines) {
    starts.push(acc)
    acc += l.length + 1
  }
  const lineAt = (pos: number) => {
    let i = 0
    while (i + 1 < starts.length && starts[i + 1] <= pos) i++
    return i
  }
  const first = lineAt(selStart)
  const last = lineAt(Math.max(selStart, selEnd))
  const range = lines.slice(first, last + 1)
  const multi = range.length > 1
  const has = (l: string) => (kind === 'check' ? CHECK_RE.test(l) : BULLET_RE.test(l) && !CHECK_RE.test(l))
  const remove = range.filter((l) => l.trim() || !multi).every(has)
  const marker = kind === 'check' ? '- [ ] ' : '- '

  let startShift = 0
  let totalShift = 0
  for (let i = first; i <= last; i++) {
    const old = lines[i]
    if (multi && !old.trim()) continue
    const p = listPrefix(old)
    const indent = p ? p.indent : (old.match(/^\s*/)?.[0] ?? '')
    const rest = p ? p.rest : old.slice(indent.length)
    lines[i] = remove ? indent + rest : indent + marker + rest
    const delta = lines[i].length - old.length
    if (i === first) startShift = delta
    totalShift += delta
  }
  const firstStart = starts[first]
  return {
    body: lines.join('\n'),
    selStart: Math.max(firstStart, selStart + startShift),
    selEnd: Math.max(firstStart, selEnd + totalShift),
  }
}

/**
 * If `next` is `prev` with a single newline typed at `caret - 1` on a list line,
 * continue the list on the new line (next number, a fresh unchecked box). On an
 * empty item, end the list instead. Works from onChange, so it also catches
 * Android keyboards that don't report Enter in keydown.
 */
export function continueList(prev: string, next: string, caret: number): Edit | null {
  const at = caret - 1
  if (next.length !== prev.length + 1 || at < 0 || next[at] !== '\n') return null
  if (next.slice(0, at) + next.slice(caret) !== prev) return null

  const lineStart = prev.lastIndexOf('\n', at - 1) + 1
  const nl = prev.indexOf('\n', at)
  const lineEnd = nl === -1 ? prev.length : nl
  const line = prev.slice(lineStart, lineEnd)
  const p = listPrefix(line)
  if (!p) return null
  const prefixLen = p.indent.length + p.marker.length
  if (at < lineStart + prefixLen) return null // Enter pressed inside the marker

  if (!p.rest.trim() && at === lineEnd) {
    // Enter on an empty item: drop the marker and end the list.
    const body = prev.slice(0, lineStart) + prev.slice(lineEnd)
    return { body, selStart: lineStart, selEnd: lineStart }
  }

  let marker = p.marker
  if (CHECK_RE.test(line)) marker = '- [ ] '
  else {
    const n = p.marker.match(/^(\d+)([.)])/)
    if (n) marker = `${Number(n[1]) + 1}${n[2]} `
  }
  const insert = p.indent + marker
  const body = next.slice(0, caret) + insert + next.slice(caret)
  const pos = caret + insert.length
  return { body, selStart: pos, selEnd: pos }
}
