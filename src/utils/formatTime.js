// 時間表示のフォーマット関連ユーティリティ

/** 秒数を "mm:ss.d"（分:秒.コンマ秒）形式にする。トランスポート表示用。 */
export function formatTimeTenths(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  const wholeSeconds = Math.floor(seconds);
  const tenths = Math.floor((seconds - wholeSeconds) * 10);
  return `${pad2(minutes)}:${pad2(wholeSeconds)}.${tenths}`;
}

/** 秒数を "mm:ss" 形式にする。本番モード・ルーラー用。 */
export function formatTimeShort(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe - minutes * 60);
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** ファイル名として安全な文字列にする（拡張子は含めない） */
export function sanitizeFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'untitled';
}
