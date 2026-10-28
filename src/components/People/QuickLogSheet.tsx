import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { DateTimePicker } from '@/components/DateTimePicker/DateTimePicker'
import { deleteInteraction, logInteraction, updateInteraction } from '@/people/queries'
import { INTERACTION_CHANNELS, INTERACTION_DIRECTIONS, normalizeDirection } from '@/people/types'
import type { Interaction, InteractionChannel, InteractionDirection, PersonWithLastInteraction } from '@/people/types'
import { suggestedChannel } from '@/people/home'
import { CHANNEL_ICONS, CHANNEL_LABEL_KEYS, DIRECTION_ICONS, DIRECTION_LABEL_KEYS } from './channels'
import { ConfirmDelete } from './ConfirmDelete'

interface Props {
  people: PersonWithLastInteraction[]
  // Who the sheet was opened for; ignored when editing an interaction.
  initialPersonIds?: string[]
  // The interaction to edit. Without one the sheet logs a new interaction.
  interaction?: Interaction
  // Preset direction for a new log: outbound from a Reach out card, unset
  // everywhere else. Ignored when editing.
  initialDirection?: InteractionDirection | null
  onClose: () => void
  onSaved?: () => void
}

// Logs (or edits) one interaction: how it happened, when, an optional note,
// and everyone it covered.
export function QuickLogSheet({ people, initialPersonIds = [], interaction, initialDirection = null, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const isEdit = Boolean(interaction)
  const first = people.find(p => p.sync_id === initialPersonIds[0])
  const [channel, setChannel] = useState<InteractionChannel>(
    interaction?.channel ?? (first && suggestedChannel(first)) ?? 'in_person',
  )
  // Optional: a log without a direction is complete. Tapping the chosen one
  // again clears it.
  const [direction, setDirection] = useState<InteractionDirection | null>(
    interaction ? normalizeDirection(interaction.direction) : initialDirection,
  )
  const [personIds, setPersonIds] = useState<string[]>(interaction?.person_sync_ids ?? initialPersonIds)
  const [date, setDate] = useState(interaction ? dayjs(interaction.occurred_at).format('YYYY-MM-DD') : '')
  const [time, setTime] = useState(interaction ? dayjs(interaction.occurred_at).format('HH:mm') : '')
  const [note, setNote] = useState(interaction?.note ?? '')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  useEscapeKey(onClose)

  const byId = useMemo(() => new Map(people.map(p => [p.sync_id, p])), [people])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people
      .filter(p => !personIds.includes(p.sync_id))
      .filter(p => p.name.toLowerCase().includes(q) || (p.nickname ?? '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [people, personIds, query])

  function occurredAt(): string | undefined {
    if (!date) return isEdit ? interaction!.occurred_at : undefined
    return dayjs(`${date}T${time || '12:00'}`).toISOString()
  }

  async function handleSave() {
    if (personIds.length === 0) { setError(t('people.log.needPerson')); return }
    setSaving(true)
    try {
      const fields = { person_sync_ids: personIds, channel, direction, note: note.trim() || null, occurred_at: occurredAt() }
      if (isEdit) await updateInteraction(interaction!.sync_id, fields)
      else await logInteraction(fields)
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!interaction) return
    await deleteInteraction(interaction.sync_id)
    onSaved?.()
    onClose()
  }

  const chip = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors'
  const on = 'bg-green-400/15 border-green-400/50 text-green-500 dark:text-green-400'
  const off = 'bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-green-400/40 hover:text-green-500'
  const input = 'w-full bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-400'

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center app-safe-bottom bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full sm:max-w-md max-h-[90svh] flex flex-col bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700/50">
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-3">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {isEdit ? t('people.log.editTitle') : t('people.log.title')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors" aria-label={t('people.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-1 space-y-4">
          <div>
            <p className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('people.log.how')}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {INTERACTION_CHANNELS.map(c => {
                const Icon = CHANNEL_ICONS[c]
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={channel === c}
                    onClick={() => setChannel(c)}
                    className={`${chip} ${channel === c ? on : off}`}
                  >
                    <Icon size={13} />
                    {t(CHANNEL_LABEL_KEYS[c])}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              {t('people.log.direction')} <span className="text-slate-400 dark:text-slate-500">{t('people.form.optional')}</span>
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {INTERACTION_DIRECTIONS.map(d => {
                const Icon = DIRECTION_ICONS[d]
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={direction === d}
                    onClick={() => setDirection(cur => (cur === d ? null : d))}
                    className={`${chip} ${direction === d ? on : off}`}
                  >
                    <Icon size={13} />
                    {t(DIRECTION_LABEL_KEYS[d])}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('people.log.who')}</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {personIds.map(id => (
                <span key={id} className={`${chip} ${on}`}>
                  {byId.get(id)?.name ?? t('people.log.unknownPerson')}
                  <button
                    type="button"
                    onClick={() => { setPersonIds(ids => ids.filter(x => x !== id)); setError('') }}
                    aria-label={t('people.log.removePerson', { name: byId.get(id)?.name ?? '' })}
                    className="hover:text-red-500"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('people.log.addPerson')}
              className={input}
            />
            {matches.length > 0 && (
              <div className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-hidden">
                {matches.map(p => (
                  <button
                    key={p.sync_id}
                    type="button"
                    onClick={() => { setPersonIds(ids => [...ids, p.sync_id]); setQuery(''); setError('') }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('people.log.when')}</p>
            <DateTimePicker
              date={date}
              time={time}
              onDateChange={setDate}
              onTimeChange={setTime}
              maxDate={dayjs().format('YYYY-MM-DD')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('people.log.note')}</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('people.log.notePlaceholder')}
              rows={3}
              className={`${input} resize-y`}
            />
          </div>
        </div>

        <div className="shrink-0 px-6 pt-4 pb-6 border-t border-slate-100 dark:border-slate-700/40 space-y-2">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-3">
            {isEdit ? (
              <button
                onClick={() => setConfirming(true)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-red-500 bg-slate-100 dark:bg-slate-700 hover:bg-red-500/10 transition-colors"
              >
                {t('people.delete')}
              </button>
            ) : (
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                {t('people.cancel')}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-green-400 border border-green-400/40 hover:text-green-300 hover:bg-green-400/10 hover:border-green-400/60 disabled:opacity-50 transition-colors"
            >
              {saving ? t('people.saving') : isEdit ? t('people.save') : t('people.log.logIt')}
            </button>
          </div>
        </div>
      </div>
      {confirming && (
        <ConfirmDelete
          message={t('people.log.deleteConfirm')}
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>,
    document.body,
  )
}
