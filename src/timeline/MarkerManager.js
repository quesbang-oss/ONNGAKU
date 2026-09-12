import { formatTimeShort } from '../utils/formatTime.js';
import { TRACK_HEADER_WIDTH } from '../utils/constants.js';

/**
 * タイムライン上部のマーカー行の描画と、
 * 左パネルのマーカー一覧の描画を担当する。
 */
export class MarkerManager {
  constructor({ trackContainerEl, markerListEl, pixelsPerSecondGetter, onSeek, onRemove }) {
    this.trackContainerEl = trackContainerEl;
    this.markerListEl = markerListEl;
    this.pixelsPerSecondGetter = pixelsPerSecondGetter;
    this.onSeek = onSeek;
    this.onRemove = onRemove;
    this.rowEl = document.createElement('div');
    this.rowEl.className = 'marker-row';
    this.trackContainerEl.appendChild(this.rowEl);
  }

  render(markers) {
    const pxPerSec = this.pixelsPerSecondGetter();

    // タイムライン上のフラグ
    this.rowEl.innerHTML = '';
    this.rowEl.style.width = `${TRACK_HEADER_WIDTH + Math.max(200, (markers.reduce((m, x) => Math.max(m, x.time), 0) + 30) * pxPerSec)}px`;
    for (const marker of markers) {
      const flag = document.createElement('button');
      flag.className = 'marker-flag';
      // ルーラー・波形・再生ヘッドと同じ120pxの表示オフセットを使う。
      flag.style.left = `${TRACK_HEADER_WIDTH + Math.max(0, marker.time) * pxPerSec}px`;
      flag.title = `${marker.icon} ${marker.label} (${formatTimeShort(marker.time)})`;
      flag.textContent = marker.icon;
      flag.setAttribute('aria-label', `マーカー: ${marker.label}`);
      flag.addEventListener('click', () => this.onSeek(marker.time));
      this.rowEl.appendChild(flag);
    }

    // 左パネルの一覧
    this.markerListEl.innerHTML = '';
    if (markers.length === 0) {
      const li = document.createElement('li');
      li.className = 'marker-empty';
      li.textContent = 'マーカーはまだありません';
      this.markerListEl.appendChild(li);
      return;
    }
    for (const marker of markers) {
      const li = document.createElement('li');
      li.className = 'marker-item';

      const jumpBtn = document.createElement('button');
      jumpBtn.className = 'marker-jump-btn';
      jumpBtn.innerHTML = `<span aria-hidden="true">${marker.icon}</span> ${escapeHtml(marker.label)} <span class="marker-time">${formatTimeShort(marker.time)}</span>`;
      jumpBtn.addEventListener('click', () => this.onSeek(marker.time));

      const removeBtn = document.createElement('button');
      removeBtn.className = 'marker-remove-btn';
      removeBtn.setAttribute('aria-label', `マーカー「${marker.label}」を削除`);
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onRemove(marker.id);
      });

      li.appendChild(jumpBtn);
      li.appendChild(removeBtn);
      this.markerListEl.appendChild(li);
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
