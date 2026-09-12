/** 上部ツールバーのボタンをアプリのアクションへ配線する。 */
export class Toolbar {
  constructor({ onNew, onOpen, onSave, onSaveAs, onImport, onUndo, onRedo, onNormalize, onHelp, onThemeToggle, onExport, onPerform }) {
    byId('btn-new').addEventListener('click', onNew);
    byId('btn-open').addEventListener('click', onOpen);
    byId('btn-save').addEventListener('click', onSave);
    byId('btn-save-as').addEventListener('click', onSaveAs);
    byId('btn-import').addEventListener('click', onImport);
    byId('btn-undo').addEventListener('click', onUndo);
    byId('btn-redo').addEventListener('click', onRedo);
    byId('btn-normalize').addEventListener('click', onNormalize);
    byId('btn-help').addEventListener('click', onHelp);
    byId('btn-theme').addEventListener('click', onThemeToggle);
    byId('btn-export').addEventListener('click', onExport);
    byId('btn-perform').addEventListener('click', onPerform);
  }

  setUndoRedoEnabled(canUndo, canRedo) {
    byId('btn-undo').disabled = !canUndo;
    byId('btn-redo').disabled = !canRedo;
  }
}

function byId(id) {
  return document.getElementById(id);
}
