import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface Props {
  message: string
  detail?: string
  onConfirm: () => void
  onCancel: () => void
}

// Above the People sheets (z-[60]) so it can confirm a delete started in one.
export function ConfirmDelete({ message, detail, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  useEscapeKey(onCancel)
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center app-safe-bottom bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-700/50">
        <p className="text-sm text-slate-800 dark:text-slate-200">{message}</p>
        {detail && <p className="text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            {t('people.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-500 hover:bg-red-400 transition-colors"
          >
            {t('people.delete')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
