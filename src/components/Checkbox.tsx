import { motion } from 'framer-motion'

export function Checkbox({
  checked,
  onChange,
  accent = '#0A84FF',
}: {
  checked: boolean
  onChange: () => void
  accent?: string
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-checked={checked}
      role="checkbox"
      className="press grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors"
      style={{
        borderColor: checked ? accent : '#C7C7CC',
        backgroundColor: checked ? accent : 'transparent',
      }}
    >
      <motion.svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        initial={false}
        animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      >
        <path
          d="M2 6.2L4.8 9L10 3"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.svg>
    </button>
  )
}
