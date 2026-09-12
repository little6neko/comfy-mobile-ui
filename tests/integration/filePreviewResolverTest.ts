import assert from 'node:assert/strict';
import {
  hasVhsPathExtensions,
  resolveFilePreviewReference,
} from '../../src/shared/utils/FilePreviewResolver';

const outputReference = resolveFilePreviewReference(
  'output/WanAnimate/雀斑少女有梨涡.png'
);
assert.equal(outputReference.ok, true);
if (outputReference.ok) {
  assert.deepEqual(outputReference.targets, [
    {
      kind: 'comfy',
      filename: '雀斑少女有梨涡.png',
      subfolder: 'WanAnimate',
      type: 'output',
    },
  ]);
}

const windowsStyleOutputReference = resolveFilePreviewReference(
  'output\\WanAnimate\\雀斑少女有梨涡.png'
);
assert.equal(windowsStyleOutputReference.ok, true);
if (windowsStyleOutputReference.ok) {
  assert.equal(windowsStyleOutputReference.targets[0]?.kind, 'comfy');
  assert.equal(windowsStyleOutputReference.targets[0]?.subfolder, 'WanAnimate');
}

const legacyReference = resolveFilePreviewReference('WanAnimate/frame.png');
assert.equal(legacyReference.ok, true);
if (legacyReference.ok) {
  assert.deepEqual(
    legacyReference.targets.map((target) =>
      target.kind === 'comfy' ? target.type : target.kind
    ),
    ['input', 'output', 'temp']
  );
  assert.equal(legacyReference.targets[0]?.filename, 'frame.png');
  assert.equal(legacyReference.targets[0]?.subfolder, 'WanAnimate');
}

const executionReference = resolveFilePreviewReference('frame.png', {
  explicitType: 'temp',
  explicitSubfolder: 'executions/123',
});
assert.equal(executionReference.ok, true);
if (executionReference.ok) {
  assert.deepEqual(executionReference.targets, [
    {
      kind: 'comfy',
      filename: 'frame.png',
      subfolder: 'executions/123',
      type: 'temp',
    },
  ]);
}

const rejectedAbsoluteReference = resolveFilePreviewReference(
  '/mnt/media/少女.png'
);
assert.deepEqual(rejectedAbsoluteReference, {
  ok: false,
  error: 'absolute_path_requires_vhs',
});

const absoluteReference = resolveFilePreviewReference('/mnt/media/少女.png', {
  allowVhsPath: true,
});
assert.equal(absoluteReference.ok, true);
if (absoluteReference.ok) {
  assert.deepEqual(absoluteReference.targets, [
    {
      kind: 'vhs-path',
      filename: '/mnt/media/少女.png',
      format: 'video/png',
    },
  ]);
}

const windowsAbsoluteReference = resolveFilePreviewReference(
  'D:\\素材\\少女.PNG',
  { allowVhsPath: true }
);
assert.equal(windowsAbsoluteReference.ok, true);
if (windowsAbsoluteReference.ok) {
  assert.deepEqual(windowsAbsoluteReference.targets, [
    {
      kind: 'vhs-path',
      filename: 'D:/素材/少女.PNG',
      format: 'video/png',
    },
  ]);
}

assert.equal(
  hasVhsPathExtensions({ vhs_path_extensions: ['png', 'mp4'] }),
  true
);
assert.equal(hasVhsPathExtensions({}), false);
assert.equal(hasVhsPathExtensions(undefined, { vhs_path_extensions: [] }), true);

console.log('File preview resolver checks passed');
