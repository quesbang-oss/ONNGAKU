import { ACCEPTED_AUDIO_EXTENSIONS } from './constants.js';

/** ファイルが対応している音声形式かどうかを、拡張子とMIMEタイプの両方で判定する。 */
export function isAcceptedAudioFile(file) {
  const name = (file.name || '').toLowerCase();
  const extOk = ACCEPTED_AUDIO_EXTENSIONS.some((ext) => name.endsWith(ext));
  const mimeOk = typeof file.type === 'string' && file.type.startsWith('audio');
  // ブラウザによっては m4a/aac に variant な MIME を付けないことがあるので拡張子判定を優先する
  return extOk || mimeOk;
}

/** DataTransfer からファイル一覧を取り出す（ドラッグ＆ドロップ用） */
export function getFilesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];
  if (dataTransfer.files && dataTransfer.files.length) {
    return Array.from(dataTransfer.files);
  }
  return [];
}

/** ブラウザ上でファイルをダウンロードさせる */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** ファイルを ArrayBuffer として読み込む */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました'));
    reader.readAsArrayBuffer(file);
  });
}

/** 短いランダムID（衝突がほぼ無い程度で十分） */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
