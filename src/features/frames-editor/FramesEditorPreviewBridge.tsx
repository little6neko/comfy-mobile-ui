import { useEffect, useRef } from 'react';
import { globalWebSocketService } from '@/infrastructure/websocket/GlobalWebSocketService';
import { useConnectionStore } from '@/ui/store/connectionStore';
import { useFramesEditorPreviewStore } from './previewStore';
import type { FramesEditorPreviewAction } from './previewModel';

interface PendingLiveAction {
  action: Extract<FramesEditorPreviewAction, { type: 'node_executing' | 'node_executed' }>;
  receivedAt: number;
}

const PENDING_EVENT_TTL_MS = 30_000;
const MAX_PENDING_PROMPTS = 50;

const readEventData = (event: unknown): Record<string, unknown> | null => {
  if (typeof event !== 'object' || event === null) return null;
  const record = event as Record<string, unknown>;
  if (typeof record.data === 'object' && record.data !== null) {
    return record.data as Record<string, unknown>;
  }
  return record;
};

export const FramesEditorPreviewBridge = () => {
  const serverUrl = useConnectionStore(state => state.url);
  const dispatch = useFramesEditorPreviewStore(state => state.dispatch);
  const previousServerUrl = useRef(serverUrl);
  const pendingLiveActions = useRef(new Map<string, PendingLiveAction[]>());

  useEffect(() => {
    if (previousServerUrl.current !== serverUrl) {
      dispatch({ type: 'clear_all' });
      pendingLiveActions.current.clear();
      previousServerUrl.current = serverUrl;
    }
  }, [dispatch, serverUrl]);

  useEffect(() => {
    const pendingActions = pendingLiveActions.current;
    const queueOrDispatch = (action: PendingLiveAction['action']) => {
      const registeredWorkflow = useFramesEditorPreviewStore
        .getState()
        .promptWorkflows[action.promptId];
      if (registeredWorkflow) {
        dispatch(action);
        return;
      }

      const now = Date.now();
      for (const [promptId, actions] of pendingActions) {
        const freshActions = actions.filter(item => now - item.receivedAt <= PENDING_EVENT_TTL_MS);
        if (freshActions.length === 0) pendingActions.delete(promptId);
        else pendingActions.set(promptId, freshActions);
      }
      if (
        !pendingActions.has(action.promptId)
        && pendingActions.size >= MAX_PENDING_PROMPTS
      ) {
        const oldestPrompt = pendingActions.keys().next().value;
        if (typeof oldestPrompt === 'string') pendingActions.delete(oldestPrompt);
      }
      const queued = pendingActions.get(action.promptId) ?? [];
      pendingActions.set(action.promptId, [
        ...queued.slice(-19),
        { action, receivedAt: now },
      ]);
    };

    const handleExecutionStarted = (event: unknown) => {
      const data = readEventData(event);
      const promptId = data?.promptId;
      const workflowId = data?.workflowId;
      // WorkflowEditor emits a synthetic event after restoring PromptTracker
      // state. Accepting it would resurrect a pre-refresh preview.
      if (
        data?.synthetic !== true
        && typeof promptId === 'string'
        && typeof workflowId === 'string'
      ) {
        dispatch({ type: 'register_prompt', promptId, workflowId });
        const queued = pendingActions.get(promptId) ?? [];
        pendingActions.delete(promptId);
        queued
          .filter(item => Date.now() - item.receivedAt <= PENDING_EVENT_TTL_MS)
          .forEach(item => dispatch(item.action));
      }
    };

    const handleExecuting = (event: unknown) => {
      const data = readEventData(event);
      const promptId = data?.prompt_id;
      const nodeId = data?.node;
      if (
        typeof promptId === 'string'
        && (typeof nodeId === 'string' || typeof nodeId === 'number')
      ) {
        queueOrDispatch({ type: 'node_executing', promptId, nodeId });
      }
    };

    const handleExecuted = (event: unknown) => {
      const data = readEventData(event);
      const promptId = data?.prompt_id;
      const nodeId = data?.node;
      if (
        typeof promptId === 'string'
        && (typeof nodeId === 'string' || typeof nodeId === 'number')
      ) {
        queueOrDispatch({
          type: 'node_executed',
          promptId,
          nodeId,
          output: data?.output,
        });
      }
    };

    const handleDisconnected = () => {
      pendingActions.clear();
      dispatch({ type: 'clear_all' });
    };

    globalWebSocketService.on('execution_started', handleExecutionStarted);
    globalWebSocketService.on('executing', handleExecuting);
    globalWebSocketService.on('executed', handleExecuted);
    globalWebSocketService.on('disconnected', handleDisconnected);

    return () => {
      // EventEmitter.offById does not remove the callback from its listener array,
      // so this bridge deliberately unsubscribes with the original function.
      globalWebSocketService.off('execution_started', handleExecutionStarted);
      globalWebSocketService.off('executing', handleExecuting);
      globalWebSocketService.off('executed', handleExecuted);
      globalWebSocketService.off('disconnected', handleDisconnected);
      pendingActions.clear();
    };
  }, [dispatch]);

  return null;
};
