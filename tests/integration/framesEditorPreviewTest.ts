#!/usr/bin/env npx tsx

import assert from 'node:assert/strict';
import {
  createFramesEditorPreviewModel,
  getFramesEditorPreview,
  reduceFramesEditorPreviewModel,
} from '../../src/features/frames-editor/previewModel';

const readyOutput = (filename: string, isInit = false) => ({
  preview: [{
    preview_str: JSON.stringify([
      { filename, type: 'temp', subfolder: '' },
      { filename: `${filename}-frame-2.png`, type: 'temp', subfolder: 'frames' },
    ]),
    is_init: isInit,
  }],
});

let state = createFramesEditorPreviewModel();
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executing',
  promptId: 'unregistered',
  nodeId: '12',
});
assert.equal(getFramesEditorPreview(state, 'workflow-a', '12'), undefined);

state = reduceFramesEditorPreviewModel(state, {
  type: 'register_prompt',
  promptId: 'prompt-1',
  workflowId: 'workflow-a',
});
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executing',
  promptId: 'prompt-1',
  nodeId: '12',
});
let preview = getFramesEditorPreview(state, 'workflow-a', '12');
assert.equal(preview?.status, 'loading');
assert.deepEqual(preview?.frames, []);

state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed',
  promptId: 'prompt-1',
  nodeId: '12',
  output: readyOutput('first.png', true),
});
preview = getFramesEditorPreview(state, 'workflow-a', '12');
assert.equal(preview?.status, 'ready');
assert.equal(preview?.frames.length, 2);
assert.equal(preview?.frames[0].filename, 'first.png');
assert.equal(preview?.isInit, true);
const firstReadyRevision = preview?.revision ?? 0;

state = reduceFramesEditorPreviewModel(state, {
  type: 'register_prompt',
  promptId: 'prompt-2',
  workflowId: 'workflow-a',
});
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executing',
  promptId: 'prompt-2',
  nodeId: 12,
});
preview = getFramesEditorPreview(state, 'workflow-a', 12);
assert.equal(preview?.status, 'loading');
assert.deepEqual(preview?.frames, [], 'a new execution must clear the old preview');

state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed',
  promptId: 'prompt-2',
  nodeId: '13',
  output: readyOutput('different-node.png'),
});
assert.equal(
  getFramesEditorPreview(state, 'workflow-a', '12')?.status,
  'loading',
  'an output from another node must not alter the active node preview',
);

state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed',
  promptId: 'prompt-1',
  nodeId: '12',
  output: readyOutput('late-old.png'),
});
preview = getFramesEditorPreview(state, 'workflow-a', '12');
assert.equal(preview?.status, 'loading', 'late output from the old prompt must be ignored');

state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed',
  promptId: 'prompt-2',
  nodeId: '12',
  output: { preview: [{ preview_str: 'not json', is_init: false }] },
});
preview = getFramesEditorPreview(state, 'workflow-a', '12');
assert.equal(preview?.status, 'error');
assert.equal(preview?.error, 'invalid_preview_str');
assert.deepEqual(preview?.frames, []);
assert.ok((preview?.revision ?? 0) > firstReadyRevision);

state = reduceFramesEditorPreviewModel(state, {
  type: 'register_prompt',
  promptId: 'prompt-b',
  workflowId: 'workflow-b',
});
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executing',
  promptId: 'prompt-b',
  nodeId: '12',
});
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed',
  promptId: 'prompt-b',
  nodeId: '12',
  output: readyOutput('workflow-b.png'),
});
assert.equal(
  getFramesEditorPreview(state, 'workflow-b', '12')?.frames[0].filename,
  'workflow-b.png',
);
assert.equal(
  getFramesEditorPreview(state, 'workflow-a', '12')?.status,
  'error',
  'workflow keys must remain isolated',
);

state = reduceFramesEditorPreviewModel(state, { type: 'clear_all' });
assert.equal(getFramesEditorPreview(state, 'workflow-a', '12'), undefined);
assert.equal(Object.keys(state.promptWorkflows).length, 0);

state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed', promptId: 'cached', nodeId: '12', output: readyOutput('replayed.png'),
});
assert.equal(getFramesEditorPreview(state, 'workflow-a', '12'), undefined,
  'replayed outputs must not appear before a new user submission');
state = reduceFramesEditorPreviewModel(state, {
  type: 'register_prompt', promptId: 'cached', workflowId: 'workflow-a',
});
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed', promptId: 'cached', nodeId: '12', output: readyOutput('cached.png'),
});
assert.equal(getFramesEditorPreview(state, 'workflow-a', '12')?.frames[0].filename, 'cached.png',
  'cached output must display without an executing event');
state = reduceFramesEditorPreviewModel(state, {
  type: 'register_prompt', promptId: 'cached-again', workflowId: 'workflow-a',
});
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed', promptId: 'cached-again', nodeId: '12', output: readyOutput('new-cache.png'),
});
state = reduceFramesEditorPreviewModel(state, {
  type: 'node_executed', promptId: 'cached', nodeId: '12', output: readyOutput('late.png'),
});
assert.equal(getFramesEditorPreview(state, 'workflow-a', '12')?.frames[0].filename, 'new-cache.png',
  'a late old output must not overwrite the newer cached result');

console.log('Frames Editor preview tests passed');
