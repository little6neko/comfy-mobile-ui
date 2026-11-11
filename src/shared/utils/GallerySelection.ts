import type { IComfyFileInfo } from '@/shared/types/comfy/IComfyFile';

export type GallerySelectionMode = 'input-copy' | 'comfy-relative-path';

export const isFhsImagePath = (nodeType: string | undefined, parameterName: string) =>
  nodeType === 'FHS_LoadImagePath' && parameterName === 'image';

export function resolveGallerySelection(
  file: Pick<IComfyFileInfo, 'filename' | 'subfolder' | 'type'>,
  mode: GallerySelectionMode = 'input-copy',
) {
  const subfolder = (file.subfolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const relativePath = subfolder ? `${subfolder}/${file.filename}` : file.filename;
  return {
    copyToInput: mode === 'input-copy' && file.type !== 'input',
    value: mode === 'comfy-relative-path' ? `${file.type}/${relativePath}` : relativePath,
  };
}
