import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, ImageIcon, Loader2 } from 'lucide-react';
import { FramesEditorWorkspace } from './FramesEditorWorkspace';
import { getFramesEditorCounts, parseFramesEditorInfo } from './model';
import { useFramesEditorPreview } from './previewStore';

interface FramesEditorLauncherProps {
  workflowId: string;
  nodeId: string | number;
  currentValue: unknown;
  isModified?: boolean;
  onCommit: (value: string) => void;
  onExecute?: (value: string) => void;
  canExecute?: boolean;
  isSubmitting?: boolean;
}

export const FramesEditorLauncher = ({
  workflowId,
  nodeId,
  currentValue,
  isModified = false,
  onCommit,
  onExecute,
  canExecute,
  isSubmitting,
}: FramesEditorLauncherProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const preview = useFramesEditorPreview(workflowId, nodeId);
  const parsedInfo = useMemo(() => parseFramesEditorInfo(currentValue), [currentValue]);
  const counts = parsedInfo.ok
    ? getFramesEditorCounts(parsedInfo.value)
    : { positive: 0, negative: 0, boxes: 0 };

  const previewStatus = (() => {
    if (!parsedInfo.ok) return t('framesEditor.status.invalidInfo');
    if (!preview) return t('framesEditor.status.empty');
    if (preview.status === 'loading') return t('framesEditor.status.loading');
    if (preview.status === 'error') return t('framesEditor.status.error');
    return t('framesEditor.status.ready', { count: preview.frames.length });
  })();

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`w-full rounded-xl border p-3 text-left transition-colors active:scale-[0.99] ${
          isModified
            ? 'border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400/50'
            : 'border-white/10 bg-black/10 hover:bg-black/20'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
            {!parsedInfo.ok || preview?.status === 'error' ? (
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            ) : preview?.status === 'loading' ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImageIcon className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">
              {t('framesEditor.open')}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-white/55">
              {t('framesEditor.summary', {
                positive: counts.positive,
                negative: counts.negative,
                boxes: counts.boxes,
              })}
            </div>
            <div className="mt-1 truncate text-[11px] text-blue-200/70">
              {previewStatus}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-white/35" />
        </div>
      </button>

      {isOpen && (
        <FramesEditorWorkspace
          currentValue={currentValue}
          preview={preview}
          onCommit={onCommit}
          onExecute={onExecute}
          canExecute={canExecute}
          isSubmitting={isSubmitting}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};
