import { useRef, useState } from 'react'
import { AlarmClockOff, Check, PhoneIncoming, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PersonWithLastInteraction } from '@/people/types'
import { cadenceRatio } from '@/people/home'
import { formatElapsed, getCadenceColor } from '@/utils/cadence'
import { logInteraction, updatePerson } from '@/people/queries'
import { SNOOZE_DAYS, snoozeUntil } from '@/people/home'
import { useShowReciprocity } from '@/people/settings'
import { CHANNEL_ICONS, DIRECTION_ICONS } from './channels'

interface Props {
  person: PersonWithLastInteraction
  onOpen: (person: PersonWithLastInteraction) => void
  onQuickLog: (person: PersonWithLastInteraction) => void
  // Why the person is on Reach out, shown under the recency line.
  reason?: string | null
  // Reach out rows offer "Not now", which hides the person for a few days.
  snoozable?: boolean
}

const LONG_PRESS_MS = 500

export function PersonRow({ person, onOpen, onQuickLog, reason = null, snoozable = false }: Props) {
  const { t } = useTranslation()
  const showReciprocity = useShowReciprocity()
  const [snoozing, setSnoozing] = useState(false)
  const ratio = cadenceRatio(person)
  const color = ratio !== null ? getCadenceColor(ratio) : '#64748b'
  const width = ratio !== null ? `${Math.min(ratio * 100, 100)}%` : '0%'
  const last = person.last_interaction_at
    ? formatElapsed(t, person.elapsed_days, person.last_interaction_at)
    : t('people.row.noContactYet')
  const ChannelIcon = person.last_channel ? CHANNEL_ICONS[person.last_channel] : null
  // The arrow rides the channel icon; mutual and unrecorded show none.
  const DirectionIcon = showReciprocity && person.last_direction && person.last_direction !== 'mutual'
    ? DIRECTION_ICONS[person.last_direction] : null
  const [inbound, setInbound] = useState<'idle' | 'done'>('idle')

  // "They got in touch": one tap, no sheet. Inbound contact is the kind
  // nothing prompts you to log, so it gets the shortest path (see the
  // reciprocity spec's logging-bias section).
  async function logInbound(e: React.MouseEvent) {
    e.stopPropagation()
    if (inbound !== 'idle') return
    await logInteraction({
      person_sync_ids: [person.sync_id],
      channel: person.preferred_channel ?? 'other',
      direction: 'inbound',
      source: 'quick_action',
    })
    setInbound('done')
    setTimeout(() => setInbound('idle'), 1500)
  }

  // Long-press opens quick-log, like the spec's swipe/hold gesture; a plain
  // tap opens the person. The timer's firing marks the press as consumed so
  // the click that follows the release does not also open the detail.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consumed = useRef(false)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (consumed.current) { consumed.current = false; return } onOpen(person) }}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(person) }}
      onPointerDown={() => {
        consumed.current = false
        clear()
        timer.current = setTimeout(() => { consumed.current = true; onQuickLog(person) }, LONG_PRESS_MS)
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={e => e.preventDefault()}
      className="relative overflow-hidden rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/40 cursor-pointer group transition-colors hover:border-slate-300 dark:hover:border-slate-600/60 select-none"
      aria-label={t('people.row.label', { name: person.name, last })}
    >
      <div
        className="absolute inset-y-0 left-0 w-1 rounded-l-xl"
        style={{ backgroundColor: color, opacity: ratio !== null ? 0.9 : 0.3 }}
      />
      <div
        className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
        style={{ width, backgroundColor: color, opacity: 0.1 }}
      />
      <div className="relative flex items-center gap-3 pl-5 pr-4 py-3">
        <span
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"
          aria-hidden
        >
          {person.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
            {person.name}
            {person.nickname && <span className="ml-1.5 text-slate-400 dark:text-slate-500 font-normal">{person.nickname}</span>}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 tabular-nums mt-0.5 flex items-center gap-1">
            {ChannelIcon && <ChannelIcon size={11} className="shrink-0" />}
            {DirectionIcon && <DirectionIcon size={10} className="shrink-0 -ml-0.5" aria-label={t(`people.direction.${person.last_direction}`)} />}
            <span className="truncate">{last}</span>
          </p>
          {reason && <p className="text-xs text-amber-600 dark:text-amber-400/90 mt-0.5 line-clamp-2">{reason}</p>}
        </div>
        {snoozable && (
          <button
            onClick={e => { e.stopPropagation(); setSnoozing(v => !v) }}
            onPointerDown={e => e.stopPropagation()}
            className={`shrink-0 p-1.5 rounded-lg border transition-colors ${
              snoozing
                ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100'
                : 'bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600/40 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
            aria-label={t('people.snooze.ariaLabel', { name: person.name })}
            aria-expanded={snoozing}
            data-tooltip={t('people.snooze.notNow')}
          >
            <AlarmClockOff size={13} />
          </button>
        )}
        <button
          onClick={logInbound}
          onPointerDown={e => e.stopPropagation()}
          className={`shrink-0 p-1.5 rounded-lg border transition-colors ${
            inbound === 'done'
              ? 'bg-green-500/20 border-green-500/40 text-green-500 dark:text-green-400'
              : 'bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600/40 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
          aria-label={t('people.row.theyGotInTouchAriaLabel', { name: person.name })}
          data-tooltip={t('people.row.theyGotInTouch')}
        >
          {inbound === 'done' ? <Check size={13} /> : <PhoneIncoming size={13} />}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onQuickLog(person) }}
          onPointerDown={e => e.stopPropagation()}
          className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600/40 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          aria-label={t('people.row.logAriaLabel', { name: person.name })}
          data-tooltip={snoozable ? t('people.row.log') : undefined}
        >
          <Plus size={12} strokeWidth={2.5} />
          {/* Reach out rows carry one more button and a reason line, so the
              Log button there is the icon alone. */}
          {!snoozable && <span>{t('people.row.log')}</span>}
        </button>
      </div>
      {snoozing && (
        <div
          className="relative flex items-center flex-wrap gap-1.5 pl-5 pr-4 pb-3 -mt-1"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          <span className="text-xs text-slate-400 dark:text-slate-500 mr-1">{t('people.snooze.notNow')}</span>
          {SNOOZE_DAYS.map(days => (
            <button
              key={days}
              onClick={async () => { setSnoozing(false); await updatePerson(person.sync_id, { snoozed_until: snoozeUntil(days) }) }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600/40 text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {t(`people.snooze.d${days}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
