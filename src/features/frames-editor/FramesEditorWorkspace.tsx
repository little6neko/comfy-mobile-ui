import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  Circle,
  ImageOff,
  Loader2,
  Redo2,
  RefreshCw,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { SimpleConfirmDialog } from '@/components/ui/SimpleConfirmDialog';
import { ComfyFileService } from '@/infrastructure/api/ComfyFileService';
import { useConnectionStore } from '@/ui/store/connectionStore';
import { FramesEditorCanvas, type FramesEditorTool } from './FramesEditorCanvas';
import {
  annotationHistoryReducer,
  annotationsFromInfo,
  cloneFramesEditorInfo,
  createAnnotationHistory,
  createResetFramesEditorInfo,
  mergeFramesEditorDraft,
  parseFramesEditorInfo,
  serializeFramesEditorInfo,
  type AnnotationHistoryAction,
  type FramesEditorInfo,
} from './model';
import type { FramesEditorNodePreview } from './previewModel';

interface FramesEditorWorkspaceProps {
  currentValue: unknown;
  preview?: FramesEditorNodePreview;
  onCommit: (value: string) => void;
  onClose: () => void;
}

type FrameLoadState =
  | { status: 'idle'; url: null }
  | { status: 'loading'; url: null }
  | { status: 'ready'; url: string }
  | { status: 'error'; url: null };

interface ToolButtonProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

const ToolButton = ({
  active = false,
  disabled = false,
  label,
  onClick,
  children,
}: ToolButtonProps) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
      active
        ? 'border-blue-400 bg-blue-500/20 text-white'
        : 'border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10'
    }`}
  >
    {children}
    <span className="hidden sm:inline">{label}</span>
  </button>
);

export const FramesEditorWorkspace = ({
  currentValue,
  preview,
  onCommit,
  onClose,
}: FramesEditorWorkspaceProps) => {
  const { t } = useTranslation();
  const serverUrl = useConnectionStore(state => state.url);
  const [initialParse] = useState(() => parseFramesEditorInfo(currentValue));
  const [baseInfo, setBaseInfo] = useState<FramesEditorInfo>(() => (
    initialParse.ok
      ? cloneFramesEditorInfo(initialParse.value)
      : createResetFramesEditorInfo(initialParse)
  ));
  const [infoIsValid, setInfoIsValid] = useState(initialParse.ok);
  const [wasReset, setWasReset] = useState(false);
  const [history, setHistory] = useState(() => createAnnotationHistory(
    annotationsFromInfo(initialParse.ok ? initialParse.value : createResetFramesEditorInfo(initialParse)),
  ));
  const [frameIndex, setFrameIndex] = useState(initialParse.ok ? initialParse.value.frame_index : 0);
  const [tool, setTool] = useState<FramesEditorTool>('positive');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [frameLoad, setFrameLoad] = useState<FrameLoadState>({ status: 'idle', url: null });
  const initialPreviewRevision = useRef(preview?.revision);
  const [previewUpdated, setPreviewUpdated] = useState(false);
  const baselineSerialized = useRef(
    initialParse.ok ? serializeFramesEditorInfo(initialParse.value) : null,
  );

  const dispatchHistory = (action: AnnotationHistoryAction) => {
    setHistory(current => annotationHistoryReducer(current, action));
  };

  const frames = preview?.status === 'ready' ? preview.frames : [];
  const maxFrameIndex = Math.max(0, frames.length - 1);
  const safeFrameIndex = Math.min(frameIndex, maxFrameIndex);
  const draftFrameIndex = frames.length > 0 ? safeFrameIndex : frameIndex;
  const frameDescriptor = frames[safeFrameIndex];
  const draftInfo = useMemo(() => mergeFramesEditorDraft(
    baseInfo,
    history.present,
    draftFrameIndex,
  ), [baseInfo, draftFrameIndex, history.present]);
  const isDirty = infoIsValid && (
    wasReset || serializeFramesEditorInfo(draftInfo) !== baselineSerialized.current
  );
  const hasAnnotations = history.present.positive_coords.length > 0
    || history.present.negative_coords.length > 0
    || history.present.bbox.length > 0;
  const canvasReady = preview?.status === 'ready' && frameLoad.status === 'ready';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  useEffect(() => {
    if (frames.length > 0 && frameIndex > maxFrameIndex) {
      setFrameIndex(maxFrameIndex);
    }
  }, [frameIndex, frames.length, maxFrameIndex]);

  useEffect(() => {
    if (
      preview?.status === 'ready'
      && preview.revision !== initialPreviewRevision.current
    ) {
      setPreviewUpdated(true);
    }
  }, [preview?.revision, preview?.status]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!frameDescriptor || !serverUrl) {
      setFrameLoad({ status: 'idle', url: null });
      return () => {
        active = false;
      };
    }

    setFrameLoad({ status: 'loading', url: null });
    const fileService = new ComfyFileService(serverUrl);
    void fileService.downloadFile({
      filename: frameDescriptor.filename,
      type: frameDescriptor.type,
      subfolder: frameDescriptor.subfolder,
    }).then((blob) => {
      if (!active) return;
      if (!blob) {
        setFrameLoad({ status: 'error', url: null });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setFrameLoad({ status: 'ready', url: objectUrl });
    }).catch(() => {
      if (active) setFrameLoad({ status: 'error', url: null });
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [frameDescriptor, retryToken, serverUrl]);

  const requestClose = () => {
    if (isDirty) setShowDiscardConfirm(true);
    else onClose();
  };

  const handleCommit = () => {
    if (!infoIsValid) return;
    if (isDirty) {
      onCommit(serializeFramesEditorInfo(draftInfo));
      toast.success(t('framesEditor.savedRunAgain'));
    }
    onClose();
  };

  const handleResetInvalidInfo = () => {
    const resetInfo = createResetFramesEditorInfo(initialParse);
    setBaseInfo(resetInfo);
    setHistory(createAnnotationHistory(annotationsFromInfo(resetInfo)));
    setFrameIndex(0);
    setInfoIsValid(true);
    setWasReset(true);
  };

  const previewNotice = preview?.isInit || previewUpdated;

  return createPortal(
    <div
      className="fixed inset-0 z-[200000] flex flex-col bg-[#080a0f] text-white"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#10131a] px-3">
        <button
          type="button"
          onClick={requestClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10"
          aria-label={t('framesEditor.close')}
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold">{t('framesEditor.title')}</h2>
          <p className="truncate text-[11px] text-slate-400">
            {t('framesEditor.summary', {
              positive: history.present.positive_coords.length,
              negative: history.present.negative_coords.length,
              boxes: history.present.bbox.length,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCommit}
          disabled={!infoIsValid}
          className="flex h-11 min-w-11 items-center justify-center rounded-xl bg-blue-600 px-3 text-white shadow-lg shadow-blue-950/30 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label={t('framesEditor.confirm')}
          title={t('framesEditor.confirm')}
        >
          <Check className="h-5 w-5" />
        </button>
      </header>

      {!infoIsValid && (
        <div className="mx-3 mt-3 flex shrink-0 items-start gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('framesEditor.invalidInfoTitle')}</p>
            <p className="mt-1 break-words text-xs text-red-200/75">
              {t('framesEditor.invalidInfoDetail', {
                code: initialParse.ok ? '' : initialParse.error.code,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="min-h-11 shrink-0 rounded-lg border border-red-300/30 px-3 text-xs font-semibold hover:bg-red-400/10"
          >
            {t('framesEditor.resetData')}
          </button>
        </div>
      )}

      {previewNotice && (
        <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <span>{t('framesEditor.previewUpdated')}</span>
        </div>
      )}

      <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 bg-[#0d1016] p-2">
        <ToolButton
          active={tool === 'positive'}
          disabled={!canvasReady || !infoIsValid}
          label={t('framesEditor.tools.positive')}
          onClick={() => setTool('positive')}
        >
          <Circle className="h-5 w-5 fill-green-500 text-green-300" />
        </ToolButton>
        <ToolButton
          active={tool === 'negative'}
          disabled={!canvasReady || !infoIsValid}
          label={t('framesEditor.tools.negative')}
          onClick={() => setTool('negative')}
        >
          <Circle className="h-5 w-5 fill-red-500 text-red-300" />
        </ToolButton>
        <ToolButton
          active={tool === 'box'}
          disabled={!canvasReady || !infoIsValid}
          label={t('framesEditor.tools.box')}
          onClick={() => setTool('box')}
        >
          <Square className="h-5 w-5 text-sky-300" />
        </ToolButton>
        <div className="mx-0.5 w-px shrink-0 bg-white/10" />
        <ToolButton
          disabled={!canvasReady || history.past.length === 0}
          label={t('framesEditor.undo')}
          onClick={() => dispatchHistory({ type: 'undo' })}
        >
          <Undo2 className="h-5 w-5" />
        </ToolButton>
        <ToolButton
          disabled={!canvasReady || history.future.length === 0}
          label={t('framesEditor.redo')}
          onClick={() => dispatchHistory({ type: 'redo' })}
        >
          <Redo2 className="h-5 w-5" />
        </ToolButton>
        <ToolButton
          disabled={!canvasReady || !hasAnnotations}
          label={t('framesEditor.clear')}
          onClick={() => setShowClearConfirm(true)}
        >
          <Trash2 className="h-5 w-5 text-red-300" />
        </ToolButton>
      </div>

      <main className="relative min-h-0 flex-1 bg-black">
        {canvasReady && frameLoad.status === 'ready' ? (
          <FramesEditorCanvas
            imageUrl={frameLoad.url}
            annotations={history.present}
            tool={tool}
            disabled={!infoIsValid}
            ariaLabel={t('framesEditor.canvasLabel')}
            onAddPoint={(kind, point) => dispatchHistory({
              type: 'add_point',
              kind,
              point,
            })}
            onAddBox={box => dispatchHistory({ type: 'add_box', box })}
            onImageError={() => setFrameLoad({ status: 'error', url: null })}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            {preview?.status === 'loading' || frameLoad.status === 'loading' ? (
              <div className="space-y-3 text-slate-300">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-400" />
                <p className="text-sm">{t('framesEditor.loadingPreview')}</p>
              </div>
            ) : preview?.status === 'error' ? (
              <div className="max-w-sm space-y-3 text-red-200">
                <AlertTriangle className="mx-auto h-9 w-9 text-red-400" />
                <p className="font-semibold">{t('framesEditor.previewErrorTitle')}</p>
                <p className="break-words text-xs text-red-200/70">{preview.error}</p>
                <p className="text-xs text-slate-400">{t('framesEditor.rerunNode')}</p>
              </div>
            ) : frameLoad.status === 'error' ? (
              <div className="max-w-sm space-y-3 text-slate-300">
                <ImageOff className="mx-auto h-9 w-9 text-slate-500" />
                <p className="font-semibold">{t('framesEditor.frameLoadFailed')}</p>
                <button
                  type="button"
                  onClick={() => setRetryToken(value => value + 1)}
                  className="mx-auto flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold hover:bg-white/15"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t('framesEditor.retry')}
                </button>
              </div>
            ) : (
              <div className="max-w-sm space-y-3 text-slate-400">
                <ImageOff className="mx-auto h-10 w-10 text-slate-600" />
                <p className="font-semibold text-slate-300">{t('framesEditor.noPreviewTitle')}</p>
                <p className="text-sm">{t('framesEditor.noPreviewDetail')}</p>
              </div>
            )}
          </div>
        )}
      </main>

      {frames.length > 1 && (
        <div className="shrink-0 border-t border-white/10 bg-[#10131a] px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
            <span>{t('framesEditor.frame')}</span>
            <span className="font-mono">{safeFrameIndex + 1} / {frames.length}</span>
          </div>
          <input
            type="range"
            min={0}
            max={maxFrameIndex}
            step={1}
            value={safeFrameIndex}
            disabled={preview?.status !== 'ready'}
            onChange={event => setFrameIndex(Number(event.target.value))}
            className="h-11 w-full cursor-pointer accent-blue-500 disabled:opacity-40"
            aria-label={t('framesEditor.frame')}
          />
        </div>
      )}

      <SimpleConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => dispatchHistory({ type: 'clear' })}
        title={t('framesEditor.clearConfirmTitle')}
        message={t('framesEditor.clearConfirmMessage')}
        confirmText={t('framesEditor.clear')}
      />
      <SimpleConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={onClose}
        title={t('framesEditor.discardTitle')}
        message={t('framesEditor.discardMessage')}
        confirmText={t('framesEditor.discard')}
      />
      <SimpleConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleResetInvalidInfo}
        title={t('framesEditor.resetTitle')}
        message={t('framesEditor.resetMessage')}
        confirmText={t('framesEditor.resetData')}
      />
    </div>,
    document.body,
  );
};
