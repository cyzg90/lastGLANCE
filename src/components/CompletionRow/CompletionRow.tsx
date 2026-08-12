import { useState, useRef } from 'react'
import { Trash2, NotebookPen } from 'lucide-react'
import type { CompletionEvent } from '@/types'
import { formatDate, formatTime } from '@/utils/datetime'
import { useTranslation } from 'react-i18next'

interface Props {
  evt: CompletionEvent
  onDelete: () => void
  onEditNote: (note: string | null) => void
  userName: string | null
  /**
   * Optional lead line rendered above the timestamp — the Journal puts the
   * chore and its category here, since its rows span every chore. Inside a
   * LogModal the chore is already the modal's subject, so it stays omitted and
   * the timestamp leads.
   */
  heading?: React.ReactNode
}

/**
 * One completion event: when, by whom, where it came from, and its note.
 *
 * Shared by the LogModal history list and the Journal so a change to how a
 * completion reads lands in both. The `logModal.*` translation keys are used as
 * they stand — these are the same strings this markup has always rendered, and
 * re-keying them would churn six locale files for no user-visible change.
 */
export function CompletionRow({ evt, onDelete, onEditNote, userName, heading }: Props) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState(evt.note ?? '')
  const noteInputRef = useRef<HTMLInputElement>(null)
  const at = evt.completed_at

  function openNoteEdit() {
    setNoteValue(evt.note ?? '')
    setEditingNote(true)
    setTimeout(() => noteInputRef.current?.focus(), 0)
  }

  function saveNote() {
    onEditNote(noteValue.trim() || null)
    setEditingNote(false)
  }

  function cancelNote() {
    setNoteValue(evt.note ?? '')
    setEditingNote(false)
  }

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700/30 group">
      <div className="flex-1 min-w-0">
        {heading}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={heading
            ? 'text-xs text-slate-400 dark:text-slate-500'
            : 'text-sm font-medium text-slate-700 dark:text-slate-200'}>
            {formatDate(at)}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">{formatTime(at)}</span>
          {userName && (
            <span className="text-xs text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">{userName}</span>
          )}
          {evt.source === 'dayglance' && (
            <span className="text-xs text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-400/10 px-1.5 py-0.5 rounded">{t('logModal.viaDayglance')}</span>
          )}
        </div>
        {editingNote ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              ref={noteInputRef}
              type="text"
              value={noteValue}
              onChange={e => setNoteValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveNote(); if (e.key === 'Escape') cancelNote() }}
              placeholder={t('logModal.addNotePlaceholder')}
              className="flex-1 bg-slate-100 dark:bg-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <button onClick={cancelNote} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0">{t('logModal.cancel')}</button>
            <button onClick={saveNote} className="text-xs text-green-500 hover:text-green-400 font-medium shrink-0">{t('logModal.saveNote')}</button>
          </div>
        ) : (
          evt.note && <p className="text-xs text-slate-400 dark:text-slate-400 italic mt-0.5">{evt.note}</p>
        )}
      </div>
      {!editingNote && (confirming ? (
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setConfirming(false)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">{t('logModal.cancel')}</button>
          <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-400 font-medium">{t('logModal.delete')}</button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <button
            onClick={openNoteEdit}
            className="text-slate-300 dark:text-slate-700 hover:text-green-400 transition-colors"
            aria-label={t('logModal.addNotePlaceholder')}
          >
            <NotebookPen size={15} />
          </button>
          <button
            onClick={() => setConfirming(true)}
            className="text-slate-300 dark:text-slate-700 hover:text-red-400 transition-colors"
            aria-label={t('logModal.delete')}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
