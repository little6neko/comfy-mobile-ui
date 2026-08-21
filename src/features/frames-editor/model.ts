export interface FramesEditorPoint {
  x: number;
  y: number;
}

export interface FramesEditorBox extends FramesEditorPoint {
  w: number;
  h: number;
}

export interface FramesEditorInfo {
  [key: string]: unknown;
  positive_coords: FramesEditorPoint[];
  negative_coords: FramesEditorPoint[];
  bbox: FramesEditorBox[];
  frame_index: number;
}

export interface FramesEditorAnnotations {
  positive_coords: FramesEditorPoint[];
  negative_coords: FramesEditorPoint[];
  bbox: FramesEditorBox[];
}

export type FramesEditorParseErrorCode =
  | 'invalid_json'
  | 'invalid_root'
  | 'invalid_positive_coords'
  | 'invalid_negative_coords'
  | 'invalid_bbox'
  | 'invalid_frame_index';

export interface FramesEditorParseError {
  code: FramesEditorParseErrorCode;
  field?: string;
}

export type FramesEditorParseResult =
  | {
      ok: true;
      value: FramesEditorInfo;
    }
  | {
      ok: false;
      error: FramesEditorParseError;
      unknownFields: Record<string, unknown>;
    };

export interface AnnotationHistoryState {
  past: FramesEditorAnnotations[];
  present: FramesEditorAnnotations;
  future: FramesEditorAnnotations[];
}

export type AnnotationHistoryAction =
  | { type: 'add_point'; kind: 'positive' | 'negative'; point: FramesEditorPoint }
  | { type: 'add_box'; box: FramesEditorBox }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' };

export interface FramesEditorSize {
  width: number;
  height: number;
}

export interface FramesEditorRect extends FramesEditorSize {
  x: number;
  y: number;
  scale: number;
}

const KNOWN_INFO_FIELDS = new Set([
  'positive_coords',
  'negative_coords',
  'bbox',
  'frame_index',
]);

const MAX_HISTORY_LENGTH = 100;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isFiniteNonNegativeNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
);

const cloneValue = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const createEmptyKnownInfo = (): FramesEditorInfo => ({
  positive_coords: [],
  negative_coords: [],
  bbox: [],
  frame_index: 0,
});

export const createEmptyFramesEditorInfo = (): FramesEditorInfo => createEmptyKnownInfo();

const extractUnknownFields = (value: Record<string, unknown>): Record<string, unknown> => {
  const unknownFields: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!KNOWN_INFO_FIELDS.has(key)) {
      unknownFields[key] = cloneValue(fieldValue);
    }
  }
  return unknownFields;
};

const parsePointArray = (
  value: unknown,
  code: 'invalid_positive_coords' | 'invalid_negative_coords',
): FramesEditorPoint[] | FramesEditorParseError => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { code };

  const points: FramesEditorPoint[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || !isFiniteNonNegativeNumber(item.x)
      || !isFiniteNonNegativeNumber(item.y)
    ) {
      return { code };
    }
    points.push({ x: item.x, y: item.y });
  }
  return points;
};

const parseBoxArray = (value: unknown): FramesEditorBox[] | FramesEditorParseError => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { code: 'invalid_bbox' };

  const boxes: FramesEditorBox[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || !isFiniteNonNegativeNumber(item.x)
      || !isFiniteNonNegativeNumber(item.y)
      || !isFiniteNonNegativeNumber(item.w)
      || !isFiniteNonNegativeNumber(item.h)
    ) {
      return { code: 'invalid_bbox' };
    }
    boxes.push({ x: item.x, y: item.y, w: item.w, h: item.h });
  }
  return boxes;
};

const parseObjectInfo = (value: Record<string, unknown>): FramesEditorParseResult => {
  const unknownFields = extractUnknownFields(value);
  const positiveCoords = parsePointArray(value.positive_coords, 'invalid_positive_coords');
  if (!Array.isArray(positiveCoords)) {
    return { ok: false, error: positiveCoords, unknownFields };
  }

  const negativeCoords = parsePointArray(value.negative_coords, 'invalid_negative_coords');
  if (!Array.isArray(negativeCoords)) {
    return { ok: false, error: negativeCoords, unknownFields };
  }

  const boxes = parseBoxArray(value.bbox);
  if (!Array.isArray(boxes)) {
    return { ok: false, error: boxes, unknownFields };
  }

  const frameIndex = value.frame_index === undefined ? 0 : value.frame_index;
  if (
    typeof frameIndex !== 'number'
    || !Number.isInteger(frameIndex)
    || frameIndex < 0
  ) {
    return {
      ok: false,
      error: { code: 'invalid_frame_index', field: 'frame_index' },
      unknownFields,
    };
  }

  return {
    ok: true,
    value: {
      ...unknownFields,
      positive_coords: positiveCoords,
      negative_coords: negativeCoords,
      bbox: boxes,
      frame_index: frameIndex,
    },
  };
};

export const parseFramesEditorInfo = (rawValue: unknown): FramesEditorParseResult => {
  if (rawValue === undefined) {
    return { ok: true, value: createEmptyKnownInfo() };
  }

  let parsedValue: unknown = rawValue;
  if (typeof rawValue === 'string') {
    if (rawValue.trim() === '') {
      return { ok: true, value: createEmptyKnownInfo() };
    }
    try {
      parsedValue = JSON.parse(rawValue) as unknown;
    } catch {
      return {
        ok: false,
        error: { code: 'invalid_json' },
        unknownFields: {},
      };
    }
  }

  if (!isRecord(parsedValue)) {
    return {
      ok: false,
      error: { code: 'invalid_root' },
      unknownFields: {},
    };
  }

  return parseObjectInfo(parsedValue);
};

export const createResetFramesEditorInfo = (
  result?: FramesEditorParseResult,
): FramesEditorInfo => ({
  ...(result && !result.ok ? cloneValue(result.unknownFields) : {}),
  ...createEmptyKnownInfo(),
});

export const cloneFramesEditorInfo = (info: FramesEditorInfo): FramesEditorInfo => (
  cloneValue(info)
);

export const serializeFramesEditorInfo = (info: FramesEditorInfo): string => {
  const unknownFields = extractUnknownFields(info);
  return JSON.stringify({
    ...unknownFields,
    positive_coords: info.positive_coords.map(point => ({ ...point })),
    negative_coords: info.negative_coords.map(point => ({ ...point })),
    bbox: info.bbox.map(box => ({ ...box })),
    frame_index: info.frame_index,
  });
};

export const annotationsFromInfo = (info: FramesEditorInfo): FramesEditorAnnotations => ({
  positive_coords: info.positive_coords.map(point => ({ ...point })),
  negative_coords: info.negative_coords.map(point => ({ ...point })),
  bbox: info.bbox.map(box => ({ ...box })),
});

export const mergeFramesEditorDraft = (
  baseInfo: FramesEditorInfo,
  annotations: FramesEditorAnnotations,
  frameIndex: number,
): FramesEditorInfo => ({
  ...extractUnknownFields(baseInfo),
  positive_coords: annotations.positive_coords.map(point => ({ ...point })),
  negative_coords: annotations.negative_coords.map(point => ({ ...point })),
  bbox: annotations.bbox.map(box => ({ ...box })),
  frame_index: frameIndex,
});

export const getFramesEditorCounts = (info: FramesEditorInfo) => ({
  positive: info.positive_coords.length,
  negative: info.negative_coords.length,
  boxes: info.bbox.length,
});

const cloneAnnotations = (annotations: FramesEditorAnnotations): FramesEditorAnnotations => ({
  positive_coords: annotations.positive_coords.map(point => ({ ...point })),
  negative_coords: annotations.negative_coords.map(point => ({ ...point })),
  bbox: annotations.bbox.map(box => ({ ...box })),
});

const annotationsEqual = (
  left: FramesEditorAnnotations,
  right: FramesEditorAnnotations,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const createAnnotationHistory = (
  annotations: FramesEditorAnnotations,
): AnnotationHistoryState => ({
  past: [],
  present: cloneAnnotations(annotations),
  future: [],
});

const commitAnnotations = (
  state: AnnotationHistoryState,
  nextAnnotations: FramesEditorAnnotations,
): AnnotationHistoryState => {
  if (annotationsEqual(state.present, nextAnnotations)) return state;
  return {
    past: [...state.past, cloneAnnotations(state.present)].slice(-MAX_HISTORY_LENGTH),
    present: cloneAnnotations(nextAnnotations),
    future: [],
  };
};

export const annotationHistoryReducer = (
  state: AnnotationHistoryState,
  action: AnnotationHistoryAction,
): AnnotationHistoryState => {
  switch (action.type) {
    case 'add_point': {
      const next = cloneAnnotations(state.present);
      const target = action.kind === 'positive'
        ? next.positive_coords
        : next.negative_coords;
      target.push({ ...action.point });
      return commitAnnotations(state, next);
    }
    case 'add_box': {
      const next = cloneAnnotations(state.present);
      next.bbox.push({ ...action.box });
      return commitAnnotations(state, next);
    }
    case 'clear':
      return commitAnnotations(state, {
        positive_coords: [],
        negative_coords: [],
        bbox: [],
      });
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: cloneAnnotations(previous),
        future: [cloneAnnotations(state.present), ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, cloneAnnotations(state.present)].slice(-MAX_HISTORY_LENGTH),
        present: cloneAnnotations(next),
        future: state.future.slice(1),
      };
    }
  }
};

export const calculateContainRect = (
  container: FramesEditorSize,
  image: FramesEditorSize,
): FramesEditorRect => {
  if (
    container.width <= 0
    || container.height <= 0
    || image.width <= 0
    || image.height <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  }

  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
    scale,
  };
};

const clamp = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

export const mapDisplayPointToImage = (
  displayPoint: FramesEditorPoint,
  displayRect: FramesEditorRect,
  image: FramesEditorSize,
  clampToImage = false,
): FramesEditorPoint | null => {
  if (
    displayRect.width <= 0
    || displayRect.height <= 0
    || image.width <= 0
    || image.height <= 0
  ) {
    return null;
  }

  const right = displayRect.x + displayRect.width;
  const bottom = displayRect.y + displayRect.height;
  const isInside = displayPoint.x >= displayRect.x
    && displayPoint.x <= right
    && displayPoint.y >= displayRect.y
    && displayPoint.y <= bottom;
  if (!isInside && !clampToImage) return null;

  const x = clamp(displayPoint.x, displayRect.x, right);
  const y = clamp(displayPoint.y, displayRect.y, bottom);
  return {
    x: ((x - displayRect.x) / displayRect.width) * image.width,
    y: ((y - displayRect.y) / displayRect.height) * image.height,
  };
};

export const normalizeFramesEditorBox = (
  start: FramesEditorPoint,
  end: FramesEditorPoint,
): FramesEditorBox => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  w: Math.abs(end.x - start.x),
  h: Math.abs(end.y - start.y),
});
