import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle, Cloud, CloudOff, RefreshCw, X } from 'lucide-react'
import type { SyncEngine, SyncErrorCode, SyncStatus } from '@glance-apps/sync'
import { useTranslation } from 'react-i18next'
import { ensureSyncFolder } from '@/sync/engine'
import { MANAGED_SYNC_FOLDER } from '@/sync/managedWebdav'
import { syncErrorText } from '@/sync/syncErrorText'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { getManagedSyncDisplayState, type ManagedSyncDisplayState } from './managedSyncDisplayState'

interface Props {
  engine: SyncEngine | null
  syncStatus: SyncStatus
  syncError: string | null
  syncErrorCode: SyncErrorCode | null
  syncHalted: boolean
  onClearSyncHalt: () => void
  onClose: () => void
}

const STATUS_ICON: Record<ManagedSyncDisplayState, typeof Cloud> = {
  halted: CloudOff,
  error: AlertTriangle,
  syncing: RefreshCw,
  connected: CheckCircle,
  idle: Cloud,
}

export function ManagedSyncStatus({
  engine,
  syncStatus,
  syncError,
  syncErrorCode,
  syncHalted,
  onClearSyncHalt,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const [manualSyncing, setManualSyncing] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState(() => engine?.getLastSynced() ?? null)
  const halted = syncHalted || (engine?.isHardStopped() ?? false)
  const displayState = getManagedSyncDisplayState(syncStatus, Boolean(syncError || manualError), halted)
  const syncing = manualSyncing || syncStatus === 'uploading' || syncStatus === 'downloading'
  const StatusIcon = STATUS_ICON[displayState]

  useEscapeKey(onClose)

  useEffect(() => {
    setLastSynced(engine?.getLastSynced() ?? null)
  }, [engine, syncStatus])

  async function handleSyncNow() {
    if (!engine || syncing || engine.isSyncing()) return
    setManualSyncing(true)
    setManualError(null)
    const before = engine.getLastSynced()
    try {
      await ensureSyncFolder(engine)
      await engine.sync()
      const after = engine.getLastSynced()
      setLastSynced(after)
      if (!after || after === before) setManualError(t('sync.syncFailed'))
    } catch (error) {
      setManualError(error instanceof Error ? error.message : t('sync.syncFailed'))
    } finally {
      setManualSyncing(false)
    }
  }

  async function handleRetrySync() {
    if (!engine || syncing || engine.isSyncing()) return
    engine.clearHardStop()
    setManualError(null)
    onClearSyncHalt()
    await handleSyncNow()
  }

  function formatLastSynced(iso: string | null): string {
    if (!iso) return t('sync.neverSynced')
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

  const statusLabel = {
    halted: t('sync.syncHalted'),
    error: t('sync.syncFailed'),
    syncing: t('sync.statusSyncing'),
    connected: t('sync.statusConnected'),
    idle: t('sync.statusIdle'),
  }[displayState]

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center app-safe-bottom bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col max-h-[90svh]">
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
          <Cloud size={18} className="text-green-400 shrink-0" />
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex-1">{t('sync.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('sync.close')}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-5 space-y-5">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-700 px-4 py-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('sync.managedWebdav')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('sync.managedDescription')}</p>
          </div>

          {halted && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40">
              <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">{t('sync.syncHalted')}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{t('sync.haltedDescription')}</p>
              </div>
              <button
                type="button"
                onClick={handleRetrySync}
                disabled={!engine || syncing}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium shrink-0 underline"
              >
                {t('sync.retrySync')}
              </button>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('sync.status')}</h3>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
              <StatusIcon
                size={18}
                className={`${displayState === 'error' || displayState === 'halted' ? 'text-amber-500' : 'text-green-400'} ${displayState === 'syncing' ? 'animate-spin' : ''}`}
              />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{statusLabel}</span>
            </div>
            {displayState === 'error' && (
              <p className="text-xs text-red-500 dark:text-red-400">
                {manualError || syncErrorText(t, syncError, syncErrorCode) || t('sync.syncFailed')}
              </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('sync.lastSynced', { date: formatLastSynced(lastSynced) })}
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('sync.managedStorage')}</h3>
            <dl className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-xs text-slate-500 dark:text-slate-400">{t('sync.managedStorage')}</dt>
                <dd className="text-sm text-slate-700 dark:text-slate-200">{t('sync.managedWebdav')}</dd>
              </div>
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-xs text-slate-500 dark:text-slate-400">{t('sync.managedFolder')}</dt>
                <dd className="text-sm text-slate-700 dark:text-slate-200">{MANAGED_SYNC_FOLDER}</dd>
              </div>
            </dl>
          </div>

          <button
            type="button"
            onClick={handleSyncNow}
            disabled={!engine || syncing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-green-400 text-white hover:bg-green-300 disabled:opacity-40 transition-colors"
          >
            {syncing && <RefreshCw size={14} className="animate-spin" />}
            {t('sync.syncNow')}
          </button>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700/40 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            {t('sync.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
