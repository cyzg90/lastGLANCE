import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, NotebookText, Download, Search } from 'lucide-react'
import dayjs from 'dayjs'
import { getJournalEntries, deleteCompletion, updateCompletionNote, type JournalEntry } from '@/db/queries'
import { useUsersContext } from '@/multiuser/UsersContext'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { CompletionRow } from '@/components/CompletionRow/CompletionRow'
import { ICON_REGISTRY } from '@/icons/registry'
import { saveCsvFile } from '@/utils/exportFile'
import { formatDayHeading, formatMonthDay } from '@/utils/datetime'
import { useTranslation } from 'react-i18next'

interface Props {
  onClose: () => void
  /**
   * Opens straight to a single day (YYYY-MM-DD) — how the header heatmap hands
   * off a tapped cell.
   */
  initialDate?: string
  /** Fired after an entry is deleted so the caller can refresh the heatmap. */
  onChanged?: () => void
}

type RangeKey = '7d' | '30d' | '90d' | 'year' | 'all' | 'custom'

const RANGE_KEYS: RangeKey[] = ['7d', '30d', '90d', 'year', 'all', 'custom']

const PAGE_SIZE = 100

// Resolve a range choice to inclusive ISO bounds in the user's local timezone,
// so "last 7 days" means seven local days and day grouping lines up with what
// the rows show. An undefined bound is open-ended.
function resolveRange(range: RangeKey, customFrom: string, customTo: string): { from?: string; to?: string } {
  const endOfToday = dayjs().endOf('day').toISOString()
  switch (range) {
    case '7d':   return { from: dayjs().subtract(6, 'day').startOf('day').toISOString(), to: endOfToday }
    case '30d':  return { from: dayjs().subtract(29, 'day').startOf('day').toISOString(), to: endOfToday }
    case '90d':  return { from: dayjs().subtract(89, 'day').startOf('day').toISOString(), to: endOfToday }
    case 'year': return { from: dayjs().startOf('year').toISOString(), to: endOfToday }
    case 'all':  return {}
    case 'custom': return {
      from: customFrom ? dayjs(customFrom).startOf('day').toISOString() : undefined,
      to: customTo ? dayjs(customTo).endOf('day').toISOString() : undefined,
    }
  }
}

function csvCell(value: string): string {
  // Quote whenever the value could otherwise break the row, doubling any quote.
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function JournalModal({ onClose, initialDate, onChanged }: Props) {
  const { t } = useTranslation()
  const { users, multiUserEnabled } = useUsersContext()
  useEscapeKey(onClose)

  const [range, setRange] = useState<RangeKey>(initialDate ? 'custom' : '30d')
  const [customFrom, setCustomFrom] = useState(initialDate ?? '')
  const [customTo, setCustomTo] = useState(initialDate ?? '')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [exporting, setExporting] = useState(false)

  const { from, to } = resolveRange(range, customFrom, customTo)

  const load = useCallback(async () => {
    const rows = await getJournalEntries({ from, to })
    setEntries(rows)
    setLoading(false)
  }, [from, to])

  useEffect(() => { setLoading(true); load() }, [load])

  // A completion logged elsewhere (a toast action, a widget tap, an arriving
  // sync) should show up here without a reopen.
  useEffect(() => {
    window.addEventListener('lg:chore-logged', load)
    window.addEventListener('lg:sync-applied', load)
    return () => {
      window.removeEventListener('lg:chore-logged', load)
      window.removeEventListener('lg:sync-applied', load)
    }
  }, [load])

  const userNameBySyncId = useMemo(
    () => new Map(users.map(u => [u.sync_id, u.name])),
    [users]
  )

  // Root categories present in the loaded range, so the filter never offers a
  // choice that would return nothing.
  const categoryOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const e of entries) {
      if (e.root_category_id != null && e.root_category_name) byId.set(e.root_category_id, e.root_category_name)
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [entries])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter(e => {
      if (userFilter !== 'all' && e.event.completed_by_user_sync_id !== userFilter) return false
      if (categoryFilter !== 'all' && String(e.root_category_id) !== categoryFilter) return false
      if (q && !e.chore_name.toLowerCase().includes(q) && !(e.event.note ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, userFilter, categoryFilter, query])

  // Any change to what is being shown starts the list back at the first page.
  useEffect(() => { setVisible(PAGE_SIZE) }, [range, customFrom, customTo, userFilter, categoryFilter, query])

  const summary = useMemo(() => {
    const chores = new Set<number>()
    const perDay = new Map<string, number>()
    for (const e of filtered) {
      chores.add(e.chore_id)
      const day = dayjs(e.event.completed_at).format('YYYY-MM-DD')
      perDay.set(day, (perDay.get(day) ?? 0) + 1)
    }
    let busiestDay: string | null = null
    let busiestCount = 0
    for (const [day, count] of perDay) {
      if (count > busiestCount) { busiestDay = day; busiestCount = count }
    }
    return { total: filtered.length, chores: chores.size, busiestDay, busiestCount }
  }, [filtered])

  // Group the visible slice by local day. Entries arrive newest-first, so the
  // groups and the rows inside them are already in the right order.
  const groups = useMemo(() => {
    const out: { day: string; entries: JournalEntry[] }[] = []
    for (const e of filtered.slice(0, visible)) {
      const day = dayjs(e.event.completed_at).format('YYYY-MM-DD')
      const last = out[out.length - 1]
      if (last && last.day === day) last.entries.push(e)
      else out.push({ day, entries: [e] })
    }
    return out
  }, [filtered, visible])

  async function handleDelete(id: number) {
    await deleteCompletion(id)
    setEntries(prev => prev.filter(e => e.event.id !== id))
    onChanged?.()
  }

  async function handleEditNote(id: number, note: string | null) {
    await updateCompletionNote(id, note)
    setEntries(prev => prev.map(e => (e.event.id === id ? { ...e, event: { ...e.event, note } } : e)))
  }

  // Exports everything currently filtered, not just the rendered page — the
  // "download your statement" action should not depend on how far you scrolled.
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const header = [
        t('journal.csvDate'), t('journal.csvTime'), t('journal.csvChore'),
        t('journal.csvCategory'), t('journal.csvUser'), t('journal.csvSource'), t('journal.csvNote'),
      ]
      const rows = filtered.map(e => {
        const at = dayjs(e.event.completed_at)
        return [
          at.format('YYYY-MM-DD'),
          at.format('HH:mm'),
          e.chore_name,
          e.category_name ?? '',
          (e.event.completed_by_user_sync_id && userNameBySyncId.get(e.event.completed_by_user_sync_id)) || '',
          e.event.source,
          e.event.note ?? '',
        ].map(v => csvCell(String(v))).join(',')
      })
      const csv = [header.map(csvCell).join(','), ...rows].join('\r\n')
      await saveCsvFile(`lastglance-journal-${dayjs().format('YYYY-MM-DD')}.csv`, csv)
    } finally {
      setExporting(false)
    }
  }

  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  function dayLabel(day: string): string {
    if (day === today) return t('journal.today')
    if (day === yesterday) return t('journal.yesterday')
    return formatDayHeading(day)
  }

  const hasFilters = userFilter !== 'all' || categoryFilter !== 'all' || query.trim() !== ''

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center app-safe-bottom bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full sm:max-w-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 shadow-2xl rounded-t-2xl sm:rounded-2xl max-h-[90svh] sm:max-h-[85svh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 sm:px-6 pt-5 pb-4 shrink-0 border-b border-slate-100 dark:border-slate-700/40">
          <NotebookText size={18} className="text-green-400 shrink-0" />
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex-1 min-w-0">
            {t('journal.title')}
          </h2>
          <button
            onClick={handleExport}
            disabled={exporting || filtered.length === 0}
            className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-40 disabled:hover:text-slate-400 transition-colors"
            aria-label={t('journal.exportCsv')}
          >
            <Download size={13} />
            <span className="hidden sm:inline">{t('journal.exportCsv')}</span>
          </button>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
            aria-label={t('journal.close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Range + filters */}
        <div className="shrink-0 px-5 sm:px-6 py-3 border-b border-slate-100 dark:border-slate-700/40 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {RANGE_KEYS.map(key => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  range === key
                    ? 'text-green-400 border-green-400/40 bg-green-400/10'
                    : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/40'
                }`}
                aria-pressed={range === key}
              >
                {t(`journal.range.${key}`)}
              </button>
            ))}
          </div>

          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo || today}
                onChange={e => setCustomFrom(e.target.value)}
                aria-label={t('journal.from')}
                className="flex-1 min-w-0 bg-slate-100 dark:bg-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-400 [color-scheme:light] dark:[color-scheme:dark]"
              />
              <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{t('journal.to')}</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                max={today}
                onChange={e => setCustomTo(e.target.value)}
                aria-label={t('journal.to')}
                className="flex-1 min-w-0 bg-slate-100 dark:bg-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-400 [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-[10rem] bg-slate-100 dark:bg-slate-700 rounded-lg px-2.5 py-1.5 border border-slate-200 dark:border-slate-600 focus-within:ring-2 focus-within:ring-green-400">
              <Search size={12} className="text-slate-400 shrink-0" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('journal.filterPlaceholder')}
                aria-label={t('journal.filterPlaceholder')}
                className="flex-1 min-w-0 bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none"
              />
            </div>
            {categoryOptions.length > 1 && (
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                aria-label={t('journal.allCategories')}
                className="bg-slate-100 dark:bg-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-400"
              >
                <option value="all">{t('journal.allCategories')}</option>
                {categoryOptions.map(([id, name]) => (
                  <option key={id} value={String(id)}>{name}</option>
                ))}
              </select>
            )}
            {multiUserEnabled && users.length > 0 && (
              <select
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
                aria-label={t('journal.allUsers')}
                className="bg-slate-100 dark:bg-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-400"
              >
                <option value="all">{t('journal.allUsers')}</option>
                {users.map(u => (
                  <option key={u.sync_id} value={u.sync_id}>{u.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Summary strip */}
        <div className="shrink-0 flex divide-x divide-slate-100 dark:divide-slate-700/60 border-b border-slate-100 dark:border-slate-700/40 bg-slate-50 dark:bg-slate-900/60">
          <SummaryCell label={t('journal.statCompletions')} value={String(summary.total)} />
          <SummaryCell label={t('journal.statChores')} value={String(summary.chores)} />
          <SummaryCell
            label={t('journal.statBusiestDay')}
            value={summary.busiestDay ? `${formatMonthDay(summary.busiestDay)} · ${summary.busiestCount}` : '—'}
          />
        </div>

        {/* Entries */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 bg-slate-50 dark:bg-slate-900/60">
          {loading ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-10 text-center">{t('journal.loading')}</p>
          ) : filtered.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-3 text-center">
              <NotebookText size={26} className="text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {hasFilters ? t('journal.emptyFiltered') : t('journal.empty')}
              </p>
              {hasFilters && (
                <button
                  onClick={() => { setUserFilter('all'); setCategoryFilter('all'); setQuery('') }}
                  className="text-xs text-green-500 dark:text-green-400 hover:text-green-400 dark:hover:text-green-300 font-medium transition-colors"
                >
                  {t('journal.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            <>
              {groups.map(group => (
                <div key={group.day}>
                  {/* The tint bleeds out to the modal edges (-mx cancels the
                      scroller's padding) and the text is padded back in, so the
                      band reads as a full-width divider with its label inset
                      rather than as a bar with the text jammed against its
                      ends — while the label stays aligned with the rows below. */}
                  <div className="sticky top-0 z-10 -mx-5 sm:-mx-6 px-5 sm:px-6 flex items-baseline justify-between gap-3 py-2 bg-slate-50 dark:bg-slate-900/95 backdrop-blur-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 truncate">
                      {dayLabel(group.day)}
                    </p>
                    <span className="text-xs text-slate-400 dark:text-slate-600 tabular-nums shrink-0">
                      {t('journal.dayCount', { count: group.entries.length })}
                    </span>
                  </div>
                  {group.entries.map(entry => {
                    const Icon = entry.chore_icon ? ICON_REGISTRY[entry.chore_icon] : null
                    return (
                      <CompletionRow
                        key={entry.event.id}
                        evt={entry.event}
                        userName={multiUserEnabled && entry.event.completed_by_user_sync_id
                          ? userNameBySyncId.get(entry.event.completed_by_user_sync_id) ?? null
                          : null}
                        onDelete={() => handleDelete(entry.event.id)}
                        onEditNote={note => handleEditNote(entry.event.id, note)}
                        heading={
                          <div className="flex items-center gap-2 min-w-0">
                            {Icon && <Icon size={13} className="shrink-0 text-slate-400" />}
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                              {entry.chore_name}
                            </span>
                            {entry.category_name && (
                              <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 truncate">
                                {entry.category_name}
                              </span>
                            )}
                          </div>
                        }
                      />
                    )
                  })}
                </div>
              ))}

              {visible < filtered.length && (
                <div className="py-4 flex justify-center">
                  <button
                    onClick={() => setVisible(v => v + PAGE_SIZE)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    {t('journal.loadMore', { count: filtered.length - visible })}
                  </button>
                </div>
              )}
              <div className="h-2" />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 py-2.5 px-3 text-center min-w-0">
      <p className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums truncate">{value}</p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{label}</p>
    </div>
  )
}
