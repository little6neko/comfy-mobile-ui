#!/usr/bin/env npx tsx

import assert from 'node:assert/strict';
import { ComfyGraph } from '../../src/core/domain/ComfyGraph';
import { ComfyGraphNode } from '../../src/core/domain/ComfyGraphNode';
import { createExecutionGraph } from '../../src/core/services/WorkflowExecutionService';
import { buildPromptExtraData, buildPromptPayload } from '../../src/infrastructure/api/ComfyPromptPayload';

const originalGraph = new ComfyGraph();
const sourceNode = new ComfyGraphNode(1, 'TestNode');
sourceNode.addWidget('number', 'seed', 1);
sourceNode.widgets_values = [1];
originalGraph._nodes = [sourceNode];
const executionGraph = createExecutionGraph(
  originalGraph,
  new Map([[1, { seed: 42 }]]),
);

assert.ok(executionGraph instanceof ComfyGraph, 'graph prototype should be preserved');
assert.equal(executionGraph._nodes[0].getWidget('seed')?.value, 42);
assert.equal(executionGraph._nodes[0].widgets_values[0], 42);
assert.equal(executionGraph.serialize().nodes[0].widgets_values[0], 42);
assert.equal(originalGraph._nodes[0].getWidget('seed')?.value, 1, 'source widgets must not be mutated');
assert.equal(originalGraph._nodes[0].widgets_values[0], 1, 'source values must not be mutated');
assert.doesNotThrow(
  () => JSON.stringify(executionGraph.serialize()),
  'serialized execution workflow must be valid JSON metadata',
);

const workflow = { nodes: [{ id: 1, widgets_values: [42] }] };
assert.deepEqual(buildPromptExtraData('auto', workflow), {
  preview_method: 'auto',
  extra_pnginfo: { workflow },
});
assert.deepEqual(buildPromptExtraData('none'), { preview_method: 'none' });
assert.deepEqual(buildPromptExtraData('taesd', 'invalid workflow'), { preview_method: 'taesd' });

const prompt = {
  '1': { class_type: 'LoadImage', inputs: { image: 'input.png' } },
  '2': { class_type: 'easy framesEditor', inputs: { images: ['1', 0] } },
  '3': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
};
const execution = { prompt, workflow };
const partial = buildPromptPayload(execution, 'client', 'prompt', 'auto', ['2']);
assert.deepEqual(partial.partial_execution_targets, ['2']);
assert.deepEqual(partial.prompt, prompt, 'retain upstream and unrelated branches for server-side targeting');
assert.deepEqual(partial.extra_data.extra_pnginfo?.workflow, workflow);
assert.equal(partial.client_id, 'client');
assert.equal(partial.prompt_id, 'prompt');
assert.equal('partial_execution_targets' in buildPromptPayload(execution, 'client', 'prompt', 'none'), false);
assert.deepEqual(buildPromptPayload(execution, 'client', 'prompt', 'auto', ['3']).partial_execution_targets, ['3'],
  'partial execution must work for other output node types too');
assert.throws(() => buildPromptPayload(execution, 'client', 'prompt', 'auto', []));
assert.throws(() => buildPromptPayload(execution, 'client', 'prompt', 'auto', ['missing']));

console.log('Prompt workflow metadata and partial execution tests passed');
