const COMFY_FILE_TYPES = ['input', 'output', 'temp'] as const;

export interface ComfyFilePreviewTarget {
  kind: 'comfy';
  filename: string;
  subfolder: string;
  type: string;
}

export interface VhsPathPreviewTarget {
  kind: 'vhs-path';
  filename: string;
  format: string;
}

export type FilePreviewTarget = ComfyFilePreviewTarget | VhsPathPreviewTarget;

export interface FilePreviewRequestOptions {
  allowVhsPath?: boolean;
  explicitType?: string;
  explicitSubfolder?: string;
}

export type FilePreviewResolution =
  | {
      ok: true;
      targets: FilePreviewTarget[];
    }
  | {
      ok: false;
      error: 'empty_path' | 'invalid_path' | 'absolute_path_requires_vhs';
    };

const normalizePathSeparators = (path: string): string =>
  path.replace(/\\/g, '/');

const isAbsolutePath = (path: string): boolean =>
  path.startsWith('/') || /^[A-Za-z]:\//.test(path);

const getPathExtension = (path: string): string => {
  const filename = path.split('/').pop() || '';
  const extensionIndex = filename.lastIndexOf('.');
  return extensionIndex >= 0 ? filename.slice(extensionIndex + 1).toLowerCase() : '';
};

const createVhsPathTarget = (path: string): VhsPathPreviewTarget => ({
  kind: 'vhs-path',
  filename: path,
  format: `video/${getPathExtension(path) || 'video'}`,
});

/**
 * Resolve a widget value into one or more concrete preview locations.
 *
 * Root-prefixed paths are authoritative. Legacy relative paths retain the
 * existing input/output/temp search order, while absolute paths are delegated
 * to VideoHelperSuite only when the calling widget explicitly supports them.
 */
export function resolveFilePreviewReference(
  rawPath: string,
  options: FilePreviewRequestOptions = {}
): FilePreviewResolution {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, error: 'empty_path' };
  }

  let normalizedPath = normalizePathSeparators(rawPath.trim());
  while (normalizedPath.startsWith('./')) {
    normalizedPath = normalizedPath.slice(2);
  }

  if (!normalizedPath) {
    return { ok: false, error: 'empty_path' };
  }

  if (isAbsolutePath(normalizedPath)) {
    if (!options.allowVhsPath) {
      return { ok: false, error: 'absolute_path_requires_vhs' };
    }

    return {
      ok: true,
      targets: [createVhsPathTarget(normalizedPath)],
    };
  }

  if (options.explicitType === 'path') {
    if (!options.allowVhsPath) {
      return { ok: false, error: 'absolute_path_requires_vhs' };
    }

    return {
      ok: true,
      targets: [createVhsPathTarget(normalizedPath)],
    };
  }

  const pathParts = normalizedPath.split('/');
  const filename = pathParts.pop() || '';

  if (!filename || pathParts.some((part) => part === '..')) {
    return { ok: false, error: 'invalid_path' };
  }

  const parsedSubfolder = pathParts.filter((part) => part && part !== '.').join('/');

  if (options.explicitType) {
    return {
      ok: true,
      targets: [
        {
          kind: 'comfy',
          filename,
          subfolder: options.explicitSubfolder ?? parsedSubfolder,
          type: options.explicitType,
        },
      ],
    };
  }

  const firstPathPart = pathParts[0]?.toLowerCase();
  if (
    firstPathPart &&
    COMFY_FILE_TYPES.includes(firstPathPart as (typeof COMFY_FILE_TYPES)[number])
  ) {
    return {
      ok: true,
      targets: [
        {
          kind: 'comfy',
          filename,
          subfolder: pathParts.slice(1).filter(Boolean).join('/'),
          type: firstPathPart,
        },
      ],
    };
  }

  return {
    ok: true,
    targets: COMFY_FILE_TYPES.map((type) => ({
      kind: 'comfy' as const,
      filename,
      subfolder: parsedSubfolder,
      type,
    })),
  };
}

/** Check widget/config metadata without coupling the resolver to UI types. */
export function hasVhsPathExtensions(...metadata: unknown[]): boolean {
  return metadata.some((value) => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    return Array.isArray(
      (value as { vhs_path_extensions?: unknown }).vhs_path_extensions
    );
  });
}
