#!/usr/bin/env npx tsx

import assert from 'node:assert/strict';
import { ComfyGraphNode } from '../../src/core/domain/ComfyGraphNode';
import {
  annotationHistoryReducer,
  annotationsFromInfo,
  calculateContainRect,
  createAnnotationHistory,
  createResetFramesEditorInfo,
  mapDisplayPointToImage,
  normalizeFramesEditorBox,
  parseFramesEditorInfo,
  serializeFramesEditorInfo,
} from '../../src/features/frames-editor/model';

const empty = parseFramesEditorInfo('   ');
assert.equal(empty.ok, true);
if (empty.ok) {
  assert.deepEqual(empty.value, {
    positive_coords: [],
    negative_coords: [],
    bbox: [],
    frame_index: 0,
  });
}

const valid = parseFramesEditorInfo(JSON.stringify({
  positive_coords: [{ x: 10.5, y: 20 }],
  negative_coords: [{ x: 30, y: 40 }],
  bbox: [{ x: 5, y: 6, w: 100, h: 80 }],
  frame_index: 3,
  future_plugin_field: { enabled: true },
}));
assert.equal(valid.ok, true);
if (!valid.ok) throw new Error('expected valid info');
assert.deepEqual(valid.value.future_plugin_field, { enabled: true });
assert.deepEqual(JSON.parse(serializeFramesEditorInfo(valid.value)), {
  future_plugin_field: { enabled: true },
  positive_coords: [{ x: 10.5, y: 20 }],
  negative_coords: [{ x: 30, y: 40 }],
  bbox: [{ x: 5, y: 6, w: 100, h: 80 }],
  frame_index: 3,
});

const malformed = parseFramesEditorInfo('{bad json');
assert.equal(malformed.ok, false);
if (malformed.ok) throw new Error('expected malformed info');
assert.equal(malformed.error.code, 'invalid_json');
assert.deepEqual(createResetFramesEditorInfo(malformed), {
  positive_coords: [],
  negative_coords: [],
  bbox: [],
  frame_index: 0,
});

const invalidRoot = parseFramesEditorInfo('null');
assert.equal(invalidRoot.ok, false);
if (!invalidRoot.ok) assert.equal(invalidRoot.error.code, 'invalid_root');

const invalidKnownField = parseFramesEditorInfo(JSON.stringify({
  positive_coords: [{ x: -1, y: 2 }],
  future_plugin_field: 'preserve me',
}));
assert.equal(invalidKnownField.ok, false);
if (invalidKnownField.ok) throw new Error('expected invalid known field');
assert.equal(invalidKnownField.error.code, 'invalid_positive_coords');
assert.deepEqual(createResetFramesEditorInfo(invalidKnownField), {
  future_plugin_field: 'preserve me',
  positive_coords: [],
  negative_coords: [],
  bbox: [],
  frame_index: 0,
});

const invalidBox = parseFramesEditorInfo(JSON.stringify({
  bbox: [{ x: 1, y: 2, w: -3, h: 4 }],
}));
assert.equal(invalidBox.ok, false);

for (const invalidNumericInfo of [
  { positive_coords: [{ x: Number.NaN, y: 2 }] },
  { negative_coords: [{ x: Number.POSITIVE_INFINITY, y: 2 }] },
  { frame_index: -1 },
  { frame_index: 1.5 },
]) {
  assert.equal(
    parseFramesEditorInfo(invalidNumericInfo).ok,
    false,
    'non-finite coordinates and invalid frame indexes must be rejected',
  );
}

let history = createAnnotationHistory(annotationsFromInfo(valid.value));
history = annotationHistoryReducer(history, {
  type: 'add_point',
  kind: 'positive',
  point: { x: 50, y: 60 },
});
assert.equal(history.present.positive_coords.length, 2);
history = annotationHistoryReducer(history, { type: 'undo' });
assert.equal(history.present.positive_coords.length, 1);
assert.equal(history.future.length, 1);
history = annotationHistoryReducer(history, { type: 'redo' });
assert.equal(history.present.positive_coords.length, 2);
history = annotationHistoryReducer(history, { type: 'undo' });
history = annotationHistoryReducer(history, {
  type: 'add_box',
  box: { x: 2, y: 3, w: 4, h: 5 },
});
assert.equal(history.future.length, 0, 'a new action must truncate the redo branch');
history = annotationHistoryReducer(history, { type: 'clear' });
assert.deepEqual(history.present, {
  positive_coords: [],
  negative_coords: [],
  bbox: [],
});
history = annotationHistoryReducer(history, { type: 'undo' });
assert.equal(history.present.bbox.length, 2, 'clear must be undoable');

const containRect = calculateContainRect(
  { width: 300, height: 300 },
  { width: 400, height: 200 },
);
assert.deepEqual(containRect, {
  x: 0,
  y: 75,
  width: 300,
  height: 150,
  scale: 0.75,
});
assert.deepEqual(
  mapDisplayPointToImage({ x: 150, y: 150 }, containRect, { width: 400, height: 200 }),
  { x: 200, y: 100 },
);
assert.equal(
  mapDisplayPointToImage({ x: 150, y: 40 }, containRect, { width: 400, height: 200 }),
  null,
  'contain letterbox presses must be ignored',
);
assert.deepEqual(
  mapDisplayPointToImage(
    { x: 350, y: 40 },
    containRect,
    { width: 400, height: 200 },
    true,
  ),
  { x: 400, y: 0 },
  'drag endpoints may clamp to the image edge',
);

assert.deepEqual(
  normalizeFramesEditorBox({ x: 10, y: 20 }, { x: 3, y: 4 }),
  { x: 3, y: 4, w: 7, h: 16 },
);

const portraitContainRect = calculateContainRect(
  { width: 400, height: 200 },
  { width: 100, height: 400 },
);
assert.deepEqual(portraitContainRect, {
  x: 175,
  y: 0,
  width: 50,
  height: 200,
  scale: 0.5,
});
assert.deepEqual(
  mapDisplayPointToImage(
    { x: 200, y: 100 },
    portraitContainRect,
    { width: 100, height: 400 },
  ),
  { x: 50, y: 200 },
);

const compatibilityNode = new ComfyGraphNode(99, 'easy framesEditor');
compatibilityNode.addWidget('STRING', 'info', 'old-info');
compatibilityNode.addWidget('FLOAT', 'preview_rescale', 1);
compatibilityNode.widgets_values.push('desktop-dom-widget-tail');
assert.equal(compatibilityNode.setWidgetValue('info', 'new-info'), true);
assert.deepEqual(
  Array.from(compatibilityNode.widgets_values),
  ['new-info', 1, 'desktop-dom-widget-tail'],
  'updating info by name must preserve preview_rescale and extra desktop widget values',
);

console.log('Frames Editor model tests passed');
