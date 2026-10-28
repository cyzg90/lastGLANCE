import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { createCircle, deleteCircle, updateCircle } from '@/people/queries'
import type { PersonCircle } from '@/people/types'
import { ConfirmDelete } from './ConfirmDelete'

interface Props {
  circles: PersonCircle[]
  onClose: () => void
}

// Add, rename, reorder and delete circles. Each change saves as it is made.
export function CircleManagerModal({ circles, onClose }: Props) {
  const { t } = useTranslation()
  const [newName, setNewName] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<PersonCircle | null>(null)
  useEscapeKey(onClose)

  async function add() {
    if (!newName.trim()) return
    await createCircle(newName)
    setNewName('')
  }

  async function rename(circle: PersonCircle) {
    const name = names[circle.sync_id]
    if (name === undefined) return
    if (name.trim() && name.trim() !== circle.name) await updateCircle(circle.sync_id, { name })
    setNames(n => { const next = { ...n }; delete next[circle.sync_id]; return next })
  }

  // Rewrites every circle's sort_order to its new position, which also heals
  // duplicate orders two devices may have created at once.
  async function move(index: number, delta: number) {
    const order = [...circles]
    const [moved] = order.splice(index, 1)
    order.splice(index + delta, 0, moved)
    for (let i = 0; i < order.length; i++) {
      if (order[i].sort_order !== i) await updateCircle(order[i].sync_id, { sort_order: i })
    }
  }

  const input = 'bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-400'
  const iconBtn = 'p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors'

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center app-safe-bottom bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full sm:max-w-md max-h-[90svh] flex flex-col bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700/50">
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-3">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('people.circles.title')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors" aria-label={t('people.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-2">
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('people.circles.hint')}</p>
          {circles.map((c, i) => (
            <div key={c.sync_id} className="flex items-center gap-1">
              <input
                type="text"
                value={names[c.sync_id] ?? c.name}
                onChange={e => setNames(n => ({ ...n, [c.sync_id]: e.target.value }))}
                onBlur={() => rename(c)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className={`${input} flex-1 min-w-0`}
                aria-label={t('people.circles.rename', { name: c.name })}
              />
              <button className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('people.circles.moveUp', { name: c.name })}>
                <ChevronUp size={14} />
              </button>
              <button className={iconBtn} disabled={i === circles.length - 1} onClick={() => move(i, 1)} aria-label={t('people.circles.moveDown', { name: c.name })}>
                <ChevronDown size={14} />
              </button>
              <button
                className={`${iconBtn} hover:text-red-500 dark:hover:text-red-400`}
                onClick={() => setDeleting(c)}
                aria-label={t('people.circles.delete', { name: c.name })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void add() }}
              placeholder={t('people.circles.newPlaceholder')}
              className={`${input} flex-1 min-w-0`}
            />
            <button
              onClick={add}
              disabled={!newName.trim()}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-green-400 border border-green-400/40 hover:bg-green-400/10 disabled:opacity-40 transition-colors"
            >
              <Plus size={14} /> {t('people.circles.add')}
            </button>
          </div>
        </div>
      </div>

      {deleting && (
        <ConfirmDelete
          message={t('people.circles.deleteConfirm', { name: deleting.name })}
          detail={t('people.circles.deleteDetail')}
          onConfirm={async () => { await deleteCircle(deleting.sync_id); setDeleting(null) }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>,
    document.body,
  )
}
