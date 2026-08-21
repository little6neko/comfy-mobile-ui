import { create } from 'zustand';
import {
  createFramesEditorPreviewKey,
  createFramesEditorPreviewModel,
  reduceFramesEditorPreviewModel,
  type FramesEditorNodePreview,
  type FramesEditorPreviewAction,
  type FramesEditorPreviewModel,
} from './previewModel';

interface FramesEditorPreviewStore extends FramesEditorPreviewModel {
  dispatch: (action: FramesEditorPreviewAction) => void;
}

export const useFramesEditorPreviewStore = create<FramesEditorPreviewStore>((set) => ({
  ...createFramesEditorPreviewModel(),
  dispatch: (action) => set((state) => reduceFramesEditorPreviewModel(state, action)),
}));

export const useFramesEditorPreview = (
  workflowId: string,
  nodeId: string | number,
): FramesEditorNodePreview | undefined => {
  const key = createFramesEditorPreviewKey(workflowId, nodeId);
  return useFramesEditorPreviewStore(state => state.nodePreviews[key]);
};
