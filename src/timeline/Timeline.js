import {
  PIXELS_PER_SECOND_DEFAULT,
  PIXELS_PER_SECOND_MIN,
  PIXELS_PER_SECOND_MAX,
  ZOOM_STEP_FACTOR,
  TRACK_HEIGHT,
  RULER_HEIGHT,
  TRACK_TYPE,
  TRACK_TYPE_LABEL,
  CLIP_COLORS,
  DB_MIN,
  DB_MAX
} from '../utils/constants.js';
import { drawWaveform } from '../audio/WaveformRenderer.js';
import { clipToScreenRect, hitTestEdge } from './TimelineClip.js';
import { formatTimeShort } from '../utils/formatTime.js';
import { getFilesFromDataTransfer } from '../utils/fileUtils.js';

/**
 * タイムライン全体（ルーラー・各トラックのCanvas・再生ヘッド・ドラッグ操作）を
 * まとめて受け持つクラス。
 */
export class Timeline {
  constructor({ dropzoneEl, rulerEl, tracksContainerEl, emptyStateEl, selection, getProject, getAudioLibrary, callbacks }) {
    this.dropzoneEl = dropzoneEl;
    this.rulerEl = rulerEl;
    this.tracksContainerEl = tracksContainerEl;
    this.emptyStateEl = emptyStateEl;
    this.selection = selection;
    this.getProject = getProject;
    this.getAudioLibrary = getAudioLibrary;
    this.callbacks = callbacks; // { onFilesDropped, onClipMove, onClipTrim, onSeek, onSelect }

    this.pixelsPerSecond = PIXELS_PER_SECOND_DEFAULT;
    this.playheadTime = 0;
    this.trackRows = new Map();
    this.dragState = null;
    this.playheadEl = null;

    this.dropzoneEl.style.position = 'relative';

    this._bindEmptyStateDrop();
    this._bindGlobalPointerEvents();
    this.selection.addEventListener('change', () => this.render());
  }

  setZoom(px) {
    this.pixelsPerSecond = Math.max(PIXELS_PER_SECOND_MIN, Math.min(PIXELS_PER_SECOND_MAX, px));
    this.render();
  }

  zoomIn() {
    this.setZoom(this.pixelsPerSecond * ZOOM_STEP_FACTOR);
  }

  zoomOut() {
    this.setZoom(this.pixelsPerSecond / ZOOM_STEP_FACTOR);
  }

  setPlayheadTime(t) {
    this.playheadTime = Math.max(0, t);
    if (this.playheadEl && this.rulerEl.style.display !== 'none') {
      this._updatePlayheadEl();
    }
  }

  scrollToTime(t) {
    this.dropzoneEl.scrollLeft = Math.max(0, t * this.pixelsPerSecond - 100);
  }

  render() {
    const project = this.getProject();
    const hasAnyClip = project.tracks.some((t) => t.clips.length > 0);

    // 音源が1つもない間は、ルーラー・トラック・再生ヘッドを完全に隠す。
    // 音源が追加されたら同じ要素をそのまま再表示する。
    this.emptyStateEl.style.display = hasAnyClip ? 'none' : 'flex';
    this.rulerEl.style.display = hasAnyClip ? '' : 'none';
    this.tracksContainerEl.style.display = hasAnyClip ? '' : 'none';

    const totalDuration = Math.max(30, project.duration + 20);
    const contentWidth = Math.max(this.dropzoneEl.clientWidth, totalDuration * this.pixelsPerSecond);

    this._renderRuler(contentWidth, totalDuration);
    this._renderTracks(project, contentWidth);
    this._ensurePlayheadEl();

    // 再生ヘッドも音源追加前は表示しない。
    if (this.playheadEl) {
      this.playheadEl.style.display = hasAnyClip ? '' : 'none';
    }

    if (hasAnyClip) {
      this._updatePlayheadEl();
    }
  }

  // ---------------- ルーラー ----------------

  _renderRuler(width, totalDuration) {
    this.rulerEl.style.width = `${width}px`;
    this.rulerEl.innerHTML = '';
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${RULER_HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'var(--ruler-bg, #e9edf5)';
    ctx.fillStyle = getCssVar('--ruler-bg', '#e9edf5');
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    const interval = niceInterval(this.pixelsPerSecond);
    ctx.strokeStyle = getCssVar('--ruler-tick', '#9aa5b8');
    ctx.fillStyle = getCssVar('--ruler-text', '#3a4256');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (let t = 0; t <= totalDuration; t += interval) {
      const x = t * this.pixelsPerSecond;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_HEIGHT - 10);
      ctx.lineTo(x + 0.5, RULER_HEIGHT);
      ctx.stroke();
      ctx.fillText(formatTimeShort(t), x + 4, RULER_HEIGHT - 14);
    }

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, x / this.pixelsPerSecond);
      this.callbacks.onSeek(time);
    });

    this.rulerEl.appendChild(canvas);
  }

  // ---------------- トラック ----------------

  _renderTracks(project, contentWidth) {
    const existingIds = new Set(project.tracks.map((t) => t.id));
    for (const [id, row] of Array.from(this.trackRows.entries())) {
      if (!existingIds.has(id)) {
        row.rowEl.remove();
        this.trackRows.delete(id);
      }
    }

    this.tracksContainerEl.style.width = `${contentWidth}px`;

    project.tracks.forEach((track) => {
      let row = this.trackRows.get(track.id);
      if (!row) {
        row = this._createTrackRow(track);
        this.trackRows.set(track.id, row);
        this.tracksContainerEl.appendChild(row.rowEl);
      }
      this._updateTrackHeader(row, track);
      const dpr = window.devicePixelRatio || 1;
      row.canvas.width = contentWidth * dpr;
      row.canvas.height = TRACK_HEIGHT * dpr;
      row.canvas.style.width = `${contentWidth}px`;
      row.canvas.style.height = `${TRACK_HEIGHT}px`;
      row.ctx.setTransform(1, 0, 0, 1, 0, 0);
      row.ctx.scale(dpr, dpr);
      this._drawTrackCanvas(row, track);
    });
  }

  _createTrackRow(track) {
    const rowEl = document.createElement('div');
    rowEl.className = 'track-row';
    rowEl.dataset.trackId = track.id;

    const headerEl = document.createElement('div');
    headerEl.className = 'track-header';

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'track-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'track-canvas';
    canvasWrap.appendChild(canvas);

    rowEl.appendChild(headerEl);
    rowEl.appendChild(canvasWrap);

    const ctx = canvas.getContext('2d');
    const row = { rowEl, headerEl, canvas, ctx, track };

    canvas.addEventListener('pointerdown', (e) => this._onCanvasPointerDown(e, row));
    canvas.addEventListener('dblclick', (e) => this._onCanvasDoubleClick(e, row));

    rowEl.addEventListener('dragover', (e) => e.preventDefault());
    rowEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = getFilesFromDataTransfer(e.dataTransfer);
      if (!files.length) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, x / this.pixelsPerSecond);
      this.callbacks.onFilesDropped(files, row.track.type, time);
    });

    return row;
  }

  _updateTrackHeader(row, track) {
    row.headerEl.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'track-label';
    label.textContent = TRACK_TYPE_LABEL[track.type] || track.name;
    row.headerEl.appendChild(label);

    const muteBtn = document.createElement('button');
    muteBtn.className = 'track-mute-btn';
    muteBtn.textContent = track.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', `${track.name}をミュート`);
    muteBtn.addEventListener('click', () => this.callbacks.onTrackMuteToggle(track.type));
    row.headerEl.appendChild(muteBtn);

    const volInput = document.createElement('input');
    volInput.type = 'range';
    volInput.min = DB_MIN;
    volInput.max = DB_MAX;
    volInput.value = track.volumeDb;
    volInput.className = 'track-volume-slider';
    volInput.setAttribute('aria-label', `${track.name}の音量`);
    volInput.addEventListener('input', () => this.callbacks.onTrackVolumeChange(track.type, Number(volInput.value)));
    row.headerEl.appendChild(volInput);
  }

  _drawTrackCanvas(row, track) {
    const ctx = row.ctx;
    const width = row.canvas.width / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, width, TRACK_HEIGHT);
    ctx.fillStyle = getCssVar('--track-bg', '#f5f7fb');
    ctx.fillRect(0, 0, width, TRACK_HEIGHT);

    const library = this.getAudioLibrary();
    const baseColor = CLIP_COLORS[track.type] || '#4C7CF3';

    for (const clip of track.clips) {
      const { x, width: cw } = clipToScreenRect(clip, this.pixelsPerSecond);
      const selected = this.selection.isSelected(clip.id);
      const y = 8;
      const h = TRACK_HEIGHT - 16;

      ctx.fillStyle = clip.muted ? '#b8bec9' : baseColor;
      roundRect(ctx, x, y, cw, h, 6);
      ctx.fill();

      const media = library.get(clip.mediaId);
      if (media && media.peaks) {
        drawWaveform(ctx, media.peaks, {
          x,
          y: y + 18,
          width: cw,
          height: h - 22,
          startSec: clip.trimStart,
          endSec: clip.trimStart + clip.duration,
          color: 'rgba(255,255,255,0.85)'
        });
      }

      // フェードの三角形オーバーレイ
      if (clip.fadeIn > 0) {
        const fw = Math.min(cw, clip.fadeIn * this.pixelsPerSecond);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + fw, y);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
      }
      if (clip.fadeOut > 0) {
        const fw = Math.min(cw, clip.fadeOut * this.pixelsPerSecond);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.moveTo(x + cw, y);
        ctx.lineTo(x + cw - fw, y);
        ctx.lineTo(x + cw, y + h);
        ctx.closePath();
        ctx.fill();
      }

      if (selected) {
        ctx.strokeStyle = getCssVar('--clip-selected-border', '#1f2937');
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, cw - 2, h - 2, 5);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      const label = clip.name + (clip.muted ? '（ミュート）' : '');
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 4, y, Math.max(0, cw - 8), 16);
      ctx.clip();
      ctx.fillText(label, x + 4, y + 1);
      ctx.restore();
    }
  }

  // ---------------- ポインタ操作（選択・移動・トリミング） ----------------

  _onCanvasPointerDown(e, row) {
    const rect = row.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / this.pixelsPerSecond;
    const track = row.track;

    const hitClip = [...track.clips].reverse().find((c) => time >= c.start && time <= c.end);

    if (!hitClip) {
      this.selection.clear();
      this.callbacks.onSeek(Math.max(0, time));
      return;
    }

    this.selection.select(hitClip.id);
    this.callbacks.onSelect(hitClip.id);

    const { x: clipX, width: clipW } = clipToScreenRect(hitClip, this.pixelsPerSecond);
    const localX = x - clipX;
    const edge = hitTestEdge(localX, clipW);

    // ドラッグでモデルを直接書き換える前に、Undo用のスナップショットを取っておく
    if (this.callbacks.onDragStart) this.callbacks.onDragStart();

    this.dragState = {
      mode: edge ? (edge === 'left' ? 'trim-left' : 'trim-right') : 'move',
      clipId: hitClip.id,
      track,
      startClientX: e.clientX,
      original: { start: hitClip.start, trimStart: hitClip.trimStart, duration: hitClip.duration }
    };
  }

  _onCanvasDoubleClick(e, row) {
    const rect = row.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / this.pixelsPerSecond;
    const track = row.track;
    const hitClip = [...track.clips].reverse().find((c) => time >= c.start && time <= c.end);
    if (!hitClip) return;
    const newName = window.prompt('クリップの名前を変更', hitClip.name);
    if (newName != null && newName.trim()) {
      this.callbacks.onRenameClip(hitClip.id, newName.trim());
    }
  }

  _bindGlobalPointerEvents() {
    window.addEventListener('pointermove', (e) => {
      if (!this.dragState) return;
      const deltaSeconds = (e.clientX - this.dragState.startClientX) / this.pixelsPerSecond;
      const { mode, clipId, track, original } = this.dragState;
      const clip = track.getClip(clipId);
      if (!clip) return;

      if (mode === 'move') {
        clip.start = Math.max(0, original.start + deltaSeconds);
      } else if (mode === 'trim-left') {
        const maxDelta = original.duration - 0.1;
        const minDelta = -original.trimStart;
        const d = Math.max(minDelta, Math.min(maxDelta, deltaSeconds));
        clip.trimStart = original.trimStart + d;
        clip.duration = original.duration - d;
        clip.start = original.start + d;
      } else if (mode === 'trim-right') {
        const maxDelta = clip.sourceDuration - original.trimStart - original.duration;
        const minDelta = -(original.duration - 0.1);
        const d = Math.max(minDelta, Math.min(maxDelta, deltaSeconds));
        clip.duration = original.duration + d;
      }
      this._drawTrackCanvas(this.trackRows.get(track.id), track);
    });

    window.addEventListener('pointerup', () => {
      if (!this.dragState) return;
      const { mode, clipId, track } = this.dragState;
      const clip = track.getClip(clipId);
      this.dragState = null;
      if (!clip) return;
      if (mode === 'move') {
        this.callbacks.onClipMove(clipId, clip.start);
      } else {
        this.callbacks.onClipTrim(clipId, { trimStart: clip.trimStart, duration: clip.duration, start: clip.start });
      }
    });
  }

  _bindEmptyStateDrop() {
    this.emptyStateEl.addEventListener('dragover', (e) => e.preventDefault());
    this.emptyStateEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = getFilesFromDataTransfer(e.dataTransfer);
      if (files.length) this.callbacks.onFilesDropped(files, TRACK_TYPE.BGM, 0);
    });
  }

  _ensurePlayheadEl() {
    if (this.playheadEl) return;
    this.playheadEl = document.createElement('div');
    this.playheadEl.className = 'playhead-line';
    this.dropzoneEl.appendChild(this.playheadEl);
  }

  _updatePlayheadEl() {
    if (!this.playheadEl) return;
    this.playheadEl.style.left = `${this.playheadTime * this.pixelsPerSecond}px`;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function niceInterval(pixelsPerSecond) {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const c of candidates) {
    if (c * pixelsPerSecond >= 55) return c;
  }
  return 600;
}

function getCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v && v.trim() ? v.trim() : fallback;
}
