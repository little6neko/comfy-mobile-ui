import React, { useState, useEffect } from 'react';
import { Image, AlertCircle } from 'lucide-react';
import { ComfyFileService } from '@/infrastructure/api/ComfyFileService';
import { useConnectionStore } from '@/ui/store/connectionStore';
import { useTranslation } from 'react-i18next';
import { resolveFilePreviewReference } from '@/shared/utils/FilePreviewResolver';

interface ImagePreviewData {
  filename?: string;
  type?: string;
  subfolder?: string;
}

interface InlineImagePreviewProps {
  imagePreview: ImagePreviewData | string;
  onClick: () => void;
  isFromExecution?: boolean; // true if from workflow execution output
  allowVhsPath?: boolean;
  themeOverride?: {
    container?: string;
    text?: string;
    secondaryText?: string;
  };
}

export const InlineImagePreview: React.FC<InlineImagePreviewProps> = ({
  imagePreview,
  onClick,
  isFromExecution = false,
  allowVhsPath = false,
  themeOverride
}) => {
  const { t } = useTranslation();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVhsPathPreview, setIsVhsPathPreview] = useState(false);
  const { url: serverUrl } = useConnectionStore();

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const loadImage = async () => {
      if (!imagePreview) return;

      setLoading(true);
      setError(null);
      setImageUrl(null);
      setIsVhsPathPreview(false);

      try {
        const serverUrlToUse = serverUrl || 'http://localhost:8188';
        const fileService = new ComfyFileService(serverUrlToUse);

        // Parse filename from imagePreview
        const rawFilename = (typeof imagePreview === 'string' ? imagePreview : imagePreview.filename) || imagePreview;

        if (!rawFilename || typeof rawFilename !== 'string') {
          throw new Error('Invalid filename');
        }

        const previewReference = resolveFilePreviewReference(rawFilename, {
          allowVhsPath,
          explicitType:
            isFromExecution && typeof imagePreview === 'object'
              ? imagePreview.type
              : undefined,
          explicitSubfolder:
            isFromExecution && typeof imagePreview === 'object'
              ? imagePreview.subfolder
              : undefined,
        });

        if (!previewReference.ok) {
          const message = previewReference.error === 'absolute_path_requires_vhs'
            ? t('media.absolutePathRequiresVhs')
            : t('media.invalidPreviewPath');
          throw new Error(message);
        }

        const vhsPathTarget = previewReference.targets.find(
          (target) => target.kind === 'vhs-path'
        );

        if (vhsPathTarget?.kind === 'vhs-path') {
          if (!cancelled) {
            setIsVhsPathPreview(true);
            setImageUrl(
              fileService.createVhsPathPreviewUrl(
                vhsPathTarget.filename,
                vhsPathTarget.format
              )
            );
          }
          return;
        }

        let blob: Blob | null = null;

        for (const target of previewReference.targets) {
          if (target.kind !== 'comfy') continue;
          try {
            blob = await fileService.downloadFile({
              filename: target.filename,
              type: target.type,
              subfolder: target.subfolder
            });

            if (blob && blob.size > 0) {
              break;
            }
          } catch {
            continue;
          }
        }

        if (blob && blob.size > 0) {
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          objectUrl = url;
          setImageUrl(objectUrl);
        } else {
          console.error('❌ [InlineImagePreview] Image not found in any location');
          throw new Error('Image not found');
        }
      } catch (err) {
        console.error('💥 [InlineImagePreview] Failed to load inline image preview:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [allowVhsPath, imagePreview, serverUrl, isFromExecution, t]);

  if (loading) {
    return (
      <div
 className="w-full h-32 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 rounded-lg flex items-center justify-center cursor-pointer hover:shadow-md transition-shadow border-2 border-dashed border-blue-300 dark:border-blue-700"
        onClick={onClick}
      >
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-sm text-blue-700 dark:text-blue-300">{t('media.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div
 className="w-full h-32 bg-gradient-to-r from-red-100 to-orange-100 dark:from-red-900/30 dark:to-orange-900/30 rounded-lg flex items-center justify-center cursor-pointer hover:shadow-md transition-shadow border-2 border-dashed border-red-300 dark:border-red-700"
        onClick={onClick}
      >
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-700 dark:text-red-300">{t('media.failedToLoad')}</p>
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 px-3 line-clamp-2">{error}</p>
          )}
          <p className="text-xs text-red-600 dark:text-red-400">{t('media.clickToRetry')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
 className={`w-full rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-all hover:scale-[1.02] group ${themeOverride?.container || 'bg-white/[0.04]'}`}
      onClick={onClick}
    >
      <div className="relative">
        {isVhsPathPreview ? (
          <video
            src={imageUrl}
            className="w-full max-h-48 object-contain"
            preload="auto"
            autoPlay
            loop
            muted
            playsInline
            controls={false}
            onError={() => setError(t('media.vhsPathPreviewFailed'))}
          />
        ) : (
          <img
            src={imageUrl}
            alt={typeof imagePreview === 'string' ? imagePreview : (imagePreview.filename || t('media.preview'))}
            className="w-full max-h-48 object-contain"
            onError={() => setError(t('media.failedToDisplayImage'))}
          />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="bg-white/90 rounded-full p-2">
            <Image className="w-5 h-5 text-[#c8ccd4]" />
          </div>
        </div>
      </div>
      <div className="p-3">
        <p className={`text-xs truncate ${themeOverride?.text || 'text-[#8a919e]'}`}>
          {typeof imagePreview === 'string' ? imagePreview : (imagePreview.filename || t('media.preview'))}
        </p>
        <p className={`text-xs mt-1 ${themeOverride?.secondaryText || 'text-blue-600 dark:text-blue-400'}`}>
          {t('media.clickToViewFullSize')}
        </p>
      </div>
    </div>
  );
};
