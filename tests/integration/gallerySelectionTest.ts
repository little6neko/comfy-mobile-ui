import assert from 'node:assert/strict';
import { isFhsImagePath, resolveGallerySelection } from '../../src/shared/utils/GallerySelection';

assert.equal(isFhsImagePath('FHS_LoadImagePath', 'image'), true);
assert.equal(isFhsImagePath('LoadImage', 'image'), false);
assert.equal(isFhsImagePath('FHS_LoadImagePath', 'custom_width'), false);
assert.equal(isFhsImagePath(undefined, 'image'), false);
for (const type of ['input', 'output', 'temp'] as const) {
  for (const subfolder of ['', '/', '目录', '目录/子目录', '/目录/子目录/']) {
    const file = { filename: '图片 01.png', subfolder, type };
    const path = [subfolder.replace(/^\/+|\/+$/g, ''), file.filename].filter(Boolean).join('/');
    assert.deepEqual(resolveGallerySelection(file, 'comfy-relative-path'), {
      copyToInput: false, value: `${type}/${path}`,
    });
    assert.deepEqual(resolveGallerySelection(file), {
      copyToInput: type !== 'input', value: path,
    });
  }
}
assert.equal(resolveGallerySelection({ filename: 'a.png', subfolder: 'one\\two', type: 'output' },
  'comfy-relative-path').value, 'output/one/two/a.png');
console.log('Gallery path selection and legacy input-copy tests passed');
