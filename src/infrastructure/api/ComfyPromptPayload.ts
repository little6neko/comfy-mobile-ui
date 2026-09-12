import type { PreviewMethod } from '@/ui/store/latentPreviewStore';
import type { PreparedWorkflowExecution } from '@/shared/types/comfy/IComfyAPI';

export interface PromptExtraData {
  preview_method: PreviewMethod;
  extra_pnginfo?: {
    workflow: Record<string, unknown>;
  };
}

export const isWorkflowMetadata = (workflow: unknown): workflow is Record<string, unknown> =>
  typeof workflow === 'object' && workflow !== null && !Array.isArray(workflow);

/** Build the optional metadata consumed by ComfyUI output nodes. */
export const buildPromptExtraData = (
  previewMethod: PreviewMethod,
  workflow?: unknown,
): PromptExtraData => ({
  preview_method: previewMethod,
  ...(isWorkflowMetadata(workflow) && {
    extra_pnginfo: {
      workflow,
    },
  }),
});

/** Keep the complete graph and metadata; only the execution targets are restricted. */
export const buildPromptPayload = (
  execution: PreparedWorkflowExecution,
  clientId: string | undefined,
  promptId: string,
  previewMethod: PreviewMethod,
  partialExecutionTargets?: string[],
) => {
  if (partialExecutionTargets && (
    partialExecutionTargets.length === 0 ||
    partialExecutionTargets.some(id => !Object.hasOwn(execution.prompt, id))
  )) {
    throw new Error('Partial execution requires valid target nodes in the prompt');
  }
  return {
    prompt: execution.prompt,
    client_id: clientId,
    prompt_id: promptId,
    extra_data: buildPromptExtraData(previewMethod, execution.workflow),
    ...(partialExecutionTargets && { partial_execution_targets: [...partialExecutionTargets] }),
  };
};
