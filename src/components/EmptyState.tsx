import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-3 py-24 text-center"
    >
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-white text-subtle shadow-card">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-xs text-sm text-subtle">{subtitle}</p>
    </motion.div>
  )
}
