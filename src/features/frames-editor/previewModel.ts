export interface FramesEditorFrameDescriptor {
  filename: string;
  type: string;
  subfolder: string;
}

export type FramesEditorPreviewStatus = 'loading' | 'ready' | 'error';

export type FramesEditorPreviewError =
  | 'invalid_output'
  | 'invalid_preview'
  | 'invalid_preview_str'
  | 'empty_frames'
  | 'invalid_frame';

export interface FramesEditorNodePreview {
  status: FramesEditorPreviewStatus;
  frames: FramesEditorFrameDescriptor[];
  isInit: boolean;
  error: FramesEditorPreviewError | null;
  activePromptId: string;
  revision: number;
}

export interface FramesEditorPreviewModel {
  promptWorkflows: Record<string, string>;
  nodePreviews: Record<string, FramesEditorNodePreview>;
  revisionCounter: number;
}

export type FramesEditorPreviewAction =
  | { type: 'register_prompt'; promptId: string; workflowId: string }
  | { type: 'node_executing'; promptId: string; nodeId: string | number }
  | {
      type: 'node_executed';
      promptId: string;
      nodeId: string | number;
      output: unknown;
    }
  | { type: 'clear_all' };

type ParsedPreview =
  | {
      ok: true;
      frames: FramesEditorFrameDescriptor[];
      isInit: boolean;
    }
  | {
      ok: false;
      error: FramesEditorPreviewError;
    };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const createFramesEditorPreviewKey = (
  workflowId: string,
  nodeId: string | number,
): string => `${workflowId}::${String(nodeId)}`;

export const createFramesEditorPreviewModel = (): FramesEditorPreviewModel => ({
  promptWorkflows: {},
  nodePreviews: {},
  revisionCounter: 0,
});

export const parseFramesEditorExecutionOutput = (output: unknown): ParsedPreview => {
  if (!isRecord(output)) return { ok: false, error: 'invalid_output' };
  const previewItems = output.preview;
  if (!Array.isArray(previewItems) || !isRecord(previewItems[0])) {
    return { ok: false, error: 'invalid_preview' };
  }

  const previewItem = previewItems[0];
  if (typeof previewItem.preview_str !== 'string') {
    return { ok: false, error: 'invalid_preview_str' };
  }

  let parsedFrames: unknown;
  try {
    parsedFrames = JSON.parse(previewItem.preview_str) as unknown;
  } catch {
    return { ok: false, error: 'invalid_preview_str' };
  }

  if (!Array.isArray(parsedFrames) || parsedFrames.length === 0) {
    return { ok: false, error: 'empty_frames' };
  }

  const frames: FramesEditorFrameDescriptor[] = [];
  for (const frame of parsedFrames) {
    if (
      !isRecord(frame)
      || typeof frame.filename !== 'string'
      || frame.filename.trim() === ''
      || typeof frame.type !== 'string'
      || typeof frame.subfolder !== 'string'
    ) {
      return { ok: false, error: 'invalid_frame' };
    }
    frames.push({
      filename: frame.filename,
      type: frame.type,
      subfolder: frame.subfolder,
    });
  }

  return {
    ok: true,
    frames,
    isInit: previewItem.is_init === true,
  };
};

export const getFramesEditorPreview = (
  model: FramesEditorPreviewModel,
  workflowId: string,
  nodeId: string | number,
): FramesEditorNodePreview | undefined => (
  model.nodePreviews[createFramesEditorPreviewKey(workflowId, nodeId)]
);

export const reduceFramesEditorPreviewModel = (
  model: FramesEditorPreviewModel,
  action: FramesEditorPreviewAction,
): FramesEditorPreviewModel => {
  switch (action.type) {
    case 'register_prompt': {
      if (!action.promptId || !action.workflowId) return model;
      return {
        ...model,
        promptWorkflows: {
          ...model.promptWorkflows,
          [action.promptId]: action.workflowId,
        },
      };
    }
    case 'node_executing': {
      const workflowId = model.promptWorkflows[action.promptId];
      if (!workflowId) return model;
      const revision = model.revisionCounter + 1;
      const key = createFramesEditorPreviewKey(workflowId, action.nodeId);
      return {
        ...model,
        revisionCounter: revision,
        nodePreviews: {
          ...model.nodePreviews,
          [key]: {
            status: 'loading',
            frames: [],
            isInit: false,
            error: null,
            activePromptId: action.promptId,
            revision,
          },
        },
      };
    }
    case 'node_executed': {
      const workflowId = model.promptWorkflows[action.promptId];
      if (!workflowId) return model;
      const key = createFramesEditorPreviewKey(workflowId, action.nodeId);
      const currentPreview = model.nodePreviews[key];
      if (!currentPreview || currentPreview.activePromptId !== action.promptId) {
        return model;
      }

      const parsed = parseFramesEditorExecutionOutput(action.output);
      const revision = model.revisionCounter + 1;
      const nextPreview: FramesEditorNodePreview = parsed.ok
        ? {
            status: 'ready',
            frames: parsed.frames,
            isInit: parsed.isInit,
            error: null,
            activePromptId: action.promptId,
            revision,
          }
        : {
            status: 'error',
            frames: [],
            isInit: false,
            error: parsed.error,
            activePromptId: action.promptId,
            revision,
          };

      return {
        ...model,
        revisionCounter: revision,
        nodePreviews: {
          ...model.nodePreviews,
          [key]: nextPreview,
        },
      };
    }
    case 'clear_all':
      return createFramesEditorPreviewModel();
  }
};
