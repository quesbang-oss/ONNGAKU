/** タイムライン上でのクリップ選択状態を管理する小さなイベント発行クラス。 */
export class TimelineSelection extends EventTarget {
  constructor() {
    super();
    this.selectedClipId = null;
  }

  select(clipId) {
    if (this.selectedClipId === clipId) return;
    this.selectedClipId = clipId;
    this.dispatchEvent(new CustomEvent('change', { detail: { clipId } }));
  }

  clear() {
    this.select(null);
  }

  isSelected(clipId) {
    return this.selectedClipId === clipId;
  }
}
