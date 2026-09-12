/**
 * クリップの「タイムライン上での見た目」を計算する純粋関数群。
 * 実データ（AudioClip）と、ズーム倍率・スクロール位置から
 * 画面上の矩形（x, width）を算出する。
 */

export function clipToScreenRect(clip, pixelsPerSecond) {
  return {
    x: clip.start * pixelsPerSecond,
    width: Math.max(2, clip.duration * pixelsPerSecond)
  };
}

export function screenXToTime(x, pixelsPerSecond) {
  return Math.max(0, x / pixelsPerSecond);
}

/** ドラッグ中のクリップが、同じトラック内の他クリップと重なるかどうかを調べる */
export function overlapsOthers(track, clip, newStart) {
  const newEnd = newStart + clip.duration;
  return track.clips.some((other) => {
    if (other.id === clip.id) return false;
    return newStart < other.end && newEnd > other.start;
  });
}

export const EDGE_HANDLE_WIDTH_PX = 8;

/** ポインタ位置がクリップの左端・右端（トリミング用ハンドル）付近かどうか判定する */
export function hitTestEdge(localX, widthPx) {
  if (localX <= EDGE_HANDLE_WIDTH_PX) return 'left';
  if (localX >= widthPx - EDGE_HANDLE_WIDTH_PX) return 'right';
  return null;
}
