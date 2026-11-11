import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { WidgetValueEditor } from '../../src/components/controls/WidgetValueEditor';
import { useConnectionStore } from '../../src/ui/store/connectionStore';
import i18n from '../../src/lib/i18n';
import '../../src/index.css';

await i18n.changeLanguage('en');
useConnectionStore.setState({ url: location.origin, isConnected: true, hasExtension: true, autoReconnectEnabled: false });
function Fixture() {
  const [value, setValue] = useState('');
  return <WidgetValueEditor param={{ name: 'image', type: 'STRING', value: '' } as any}
    nodeId={1} node={{ type: 'FHS_LoadImagePath' } as any} currentValue={value}
    isEditing={false} editingValue="" uploadState={{ isUploading: false }}
    onPathFileSelected={(_id, _name, path) => { (window as any).selected = path; setValue(path); }}
    onStartEditing={() => { (window as any).manual = true; }}
    onCancelEditing={() => {}} onSaveEditing={() => {}} onEditingValueChange={() => {}}
    onFilePreview={() => {}} onFileUpload={() => {}} />;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><Fixture /></MemoryRouter>);
