import { AudioTrack } from '../audio/AudioTrack.js';
import { AudioClip } from '../audio/AudioClip.js';
import { generateId } from '../utils/fileUtils.js';
import { TRACK_TYPE, UNDO_HISTORY_LIMIT, DB_MIN, DB_MAX, DEFAULT_COUNTDOWN_SECONDS } from '../utils/constants.js';

/** プロジェクト全体のデータモデル。 */
export class Project {
  constructor(data = {}) {
    this.id = data.id || generateId('project');
    this.name = data.name || '無題のプロジェクト';
    this.tracks = data.tracks || [
      new AudioTrack({ type: TRACK_TYPE.BGM, name: 'BGM' }),
      new AudioTrack({ type: TRACK_TYPE.SFX, name: '効果音' })
    ];
    this.markers = data.markers || [];
    this.masterVolumeDb = data.masterVolumeDb ?? 0;
    this.masterMuted = data.masterMuted ?? false;
    this.countdownSeconds = data.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS;
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
  }

  get bgmTrack() {
    return this.tracks.find((t) => t.type === TRACK_TYPE.BGM);
  }

  get sfxTrack() {
    return this.tracks.find((t) => t.type === TRACK_TYPE.SFX);
  }

  get duration() {
    return this.tracks.reduce((max, t) => Math.max(max, t.duration), 0);
  }

  /** セットリスト表示用に、BGMトラックのクリップを開始時刻順に並べたもの */
  get setlistItems() {
    const clips = [...this.bgmTrack.clips].sort((a, b) => a.start - b.start);
    return clips.map((clip, index) => ({
      index: index + 1,
      clip
    }));
  }

  findClip(clipId) {
    for (const track of this.tracks) {
      const clip = track.getClip(clipId);
      if (clip) return { clip, track };
    }
    return { clip: null, track: null };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      tracks: this.tracks.map((t) => t.toJSON()),
      markers: this.markers,
      masterVolumeDb: this.masterVolumeDb,
      masterMuted: this.masterMuted,
      countdownSeconds: this.countdownSeconds,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static fromJSON(json) {
    return new Project({ ...json, tracks: (json.tracks || []).map(AudioTrack.fromJSON) });
  }

  clone() {
    return Project.fromJSON(JSON.parse(JSON.stringify(this.toJSON())));
  }
}

/**
 * プロジェクトの状態管理・編集操作・Undo/Redo をまとめて受け持つクラス。
 * UI 側はここのメソッドを呼び出すだけで、モデルの整合性はこちらで保証する。
 */
export class ProjectManager extends EventTarget {
  constructor(audioLibrary) {
    super();
    this.audioLibrary = audioLibrary;
    this.project = new Project();
    this.undoStack = [];
    this.redoStack = [];
    this.selectedClipId = null;
  }

  emitChange(reason = 'update') {
    this.project.updatedAt = Date.now();
    this.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
  }

  /** 破壊的な操作の前に呼ぶ。呼んだ時点の状態をUndoスタックへ積む。 */
  snapshot() {
    this.undoStack.push(JSON.stringify(this.project.toJSON()));
    if (this.undoStack.length > UNDO_HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return;
    this.redoStack.push(JSON.stringify(this.project.toJSON()));
    const prev = this.undoStack.pop();
    this.project = Project.fromJSON(JSON.parse(prev));
    this.emitChange('undo');
  }

  redo() {
    if (!this.canRedo()) return;
    this.undoStack.push(JSON.stringify(this.project.toJSON()));
    const next = this.redoStack.pop();
    this.project = Project.fromJSON(JSON.parse(next));
    this.emitChange('redo');
  }

  newProject() {
    this.project = new Project();
    this.undoStack = [];
    this.redoStack = [];
    this.selectedClipId = null;
    this.emitChange('new');
  }

  loadProject(project) {
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedClipId = null;
    this.emitChange('load');
  }

  // ---------- クリップの取り込み ----------

  /** インポートしたメディアをトラックへクリップとして追加する。 */
  addClipFromMedia(trackType, mediaMeta, { start = null } = {}) {
    this.snapshot();
    const track = this.project.tracks.find((t) => t.type === trackType);
    const placeAt = start != null ? start : track.duration; // 既定では末尾に追加
    const clip = new AudioClip({
      mediaId: mediaMeta.mediaId,
      name: mediaMeta.name.replace(/\.[^.]+$/, ''),
      start: placeAt,
      trimStart: 0,
      duration: mediaMeta.duration,
      sourceDuration: mediaMeta.duration
    });
    track.addClip(clip);
    this.emitChange('add-clip');
    return clip;
  }

  // ---------- クリップ編集 ----------

  moveClip(clipId, newStart, { skipSnapshot = false } = {}) {
    const { clip } = this.project.findClip(clipId);
    if (!clip) return;
    if (!skipSnapshot) this.snapshot();
    clip.start = Math.max(0, newStart);
    this.project.tracks.forEach((t) => t.sortClips());
    this.emitChange('move-clip');
  }

  /** タイムライン上のドラッグでトリミングした結果を確定する（スナップショットはドラッグ開始時に取得済み）。 */
  commitClipTrim(clipId, { trimStart, duration, start }) {
    const { clip } = this.project.findClip(clipId);
    if (!clip) return;
    if (trimStart != null) clip.trimStart = trimStart;
    if (duration != null) clip.duration = duration;
    if (start != null) clip.start = start;
    this.project.tracks.forEach((t) => t.sortClips());
    this.emitChange('trim-clip');
  }

  deleteClip(clipId) {
    const { track } = this.project.findClip(clipId);
    if (!track) return;
    this.snapshot();
    track.removeClip(clipId);
    if (this.selectedClipId === clipId) this.selectedClipId = null;
    this.emitChange('delete-clip');
  }

  duplicateClip(clipId) {
    const { clip, track } = this.project.findClip(clipId);
    if (!clip) return null;
    this.snapshot();
    const copy = clip.clone({ start: clip.end + 0.05 });
    track.addClip(copy);
    this.emitChange('duplicate-clip');
    return copy;
  }

  /** 再生ヘッド位置でクリップを2つに分割する */
  splitClip(clipId, atTime) {
    const { clip, track } = this.project.findClip(clipId);
    if (!clip) return null;
    if (atTime <= clip.start + 0.02 || atTime >= clip.end - 0.02) return null; // 端に近すぎる場合は分割しない
    this.snapshot();

    const firstDuration = atTime - clip.start;
    const secondDuration = clip.duration - firstDuration;

    const second = clip.clone({
      start: atTime,
      trimStart: clip.trimStart + firstDuration,
      duration: secondDuration,
      fadeIn: 0, // 分割断面にはフェードを引き継がない
      fadeOut: clip.fadeOut
    });

    clip.duration = firstDuration;
    clip.fadeOut = 0;

    track.addClip(second);
    this.emitChange('split-clip');
    return { first: clip, second };
  }

  setClipVolume(clipId, volumeDb) {
    const { clip } = this.project.findClip(clipId);
    if (!clip) return;
    this.snapshot();
    clip.volumeDb = clamp(volumeDb, DB_MIN, DB_MAX);
    this.emitChange('clip-volume');
  }

  setClipFade(clipId, { fadeIn, fadeOut }) {
    const { clip } = this.project.findClip(clipId);
    if (!clip) return;
    this.snapshot();
    if (fadeIn != null) clip.fadeIn = Math.max(0, Math.min(fadeIn, clip.duration));
    if (fadeOut != null) clip.fadeOut = Math.max(0, Math.min(fadeOut, clip.duration));
    this.emitChange('clip-fade');
  }

  setClipMuted(clipId, muted) {
    const { clip } = this.project.findClip(clipId);
    if (!clip) return;
    this.snapshot();
    clip.muted = muted;
    this.emitChange('clip-mute');
  }

  // ---------- 曲間の無音・クロスフェード（BGMトラック限定） ----------

  /** 選択中クリップと、その次のクリップとの間に無音時間を設定し、以降を詰め直す */
  applyGapAfterClip(clipId, gapSeconds) {
    const track = this.project.bgmTrack;
    const clip = track.getClip(clipId);
    if (!clip) return;
    this.snapshot();
    clip.gapAfter = Math.max(0, gapSeconds);
    clip.crossfadeWithNext = 0;
    this.reflowBgmTrack();
    this.emitChange('apply-gap');
  }

  /** 選択中クリップと次のクリップをクロスフェードでつなぐ */
  applyCrossfadeAfterClip(clipId, seconds) {
    const track = this.project.bgmTrack;
    const clip = track.getClip(clipId);
    if (!clip) return;
    this.snapshot();
    const seconds2 = Math.max(0, seconds);
    clip.crossfadeWithNext = seconds2;
    clip.gapAfter = 0;
    clip.fadeOut = Math.max(clip.fadeOut, seconds2);
    const ordered = [...track.clips].sort((a, b) => a.start - b.start);
    const idx = ordered.findIndex((c) => c.id === clipId);
    const next = ordered[idx + 1];
    if (next) next.fadeIn = Math.max(next.fadeIn, seconds2);
    this.reflowBgmTrack();
    this.emitChange('apply-crossfade');
  }

  /** BGMトラックのクリップを開始順に並べ直し、gapAfter / crossfadeWithNext を反映して start を再計算する */
  reflowBgmTrack() {
    const track = this.project.bgmTrack;
    const ordered = [...track.clips].sort((a, b) => a.start - b.start);
    let cursor = ordered.length ? ordered[0].start : 0;
    ordered.forEach((clip, i) => {
      clip.start = cursor;
      const gap = clip.gapAfter || 0;
      const crossfade = clip.crossfadeWithNext || 0;
      cursor = clip.end + gap - crossfade;
    });
    track.clips = ordered;
  }

  /** セットリストパネルからのドラッグ並べ替え。clipIds は新しい順序。 */
  reorderSetlist(clipIdsInNewOrder) {
    const track = this.project.bgmTrack;
    this.snapshot();
    const byId = new Map(track.clips.map((c) => [c.id, c]));
    const reordered = clipIdsInNewOrder.map((id) => byId.get(id)).filter(Boolean);
    // 万一漏れがあれば末尾に追加
    track.clips.forEach((c) => { if (!reordered.includes(c)) reordered.push(c); });
    track.clips = reordered;
    this.reflowBgmTrack();
    this.emitChange('reorder-setlist');
  }

  renameClip(clipId, newName) {
    const { clip } = this.project.findClip(clipId);
    if (!clip) return;
    this.snapshot();
    clip.name = newName;
    this.emitChange('rename-clip');
  }

  // ---------- トラック／マスター音量 ----------

  setTrackVolume(trackType, volumeDb) {
    const track = this.project.tracks.find((t) => t.type === trackType);
    if (!track) return;
    track.volumeDb = clamp(volumeDb, DB_MIN, DB_MAX);
    this.emitChange('track-volume');
  }

  setTrackMuted(trackType, muted) {
    const track = this.project.tracks.find((t) => t.type === trackType);
    if (!track) return;
    track.muted = muted;
    this.emitChange('track-mute');
  }

  setMasterVolume(volumeDb) {
    this.project.masterVolumeDb = clamp(volumeDb, DB_MIN, DB_MAX);
    this.emitChange('master-volume');
  }

  setMasterMuted(muted) {
    this.project.masterMuted = muted;
    this.emitChange('master-mute');
  }

  // ---------- 音量自動調整（簡易ラウドネス正規化） ----------

  /**
   * BGMトラックの各クリップについて、参照している音声データのRMS（実効値）から
   * おおよそのラウドネス差を計算し、基準値へ揃えるための volumeDb を自動設定する。
   * 本格的な LUFS 測定ではないが、「1曲だけ極端に大きい/小さい」を緩和できる。
   */
  normalizeBgmVolumes(targetDb = -16) {
    const track = this.project.bgmTrack;
    if (!track.clips.length) return false;
    this.snapshot();
    for (const clip of track.clips) {
      const media = this.audioLibrary.get(clip.mediaId);
      if (!media) continue;
      const rmsDb = estimateRmsDb(media.audioBuffer, clip.trimStart, clip.duration);
      if (!Number.isFinite(rmsDb)) continue;
      const delta = targetDb - rmsDb;
      clip.volumeDb = clamp(delta, DB_MIN, DB_MAX);
    }
    this.emitChange('normalize-volume');
    return true;
  }

  // ---------- マーカー ----------

  addMarker({ time, icon, label }) {
    this.snapshot();
    const marker = { id: generateId('marker'), time, icon, label };
    this.project.markers.push(marker);
    this.project.markers.sort((a, b) => a.time - b.time);
    this.emitChange('add-marker');
    return marker;
  }

  removeMarker(markerId) {
    this.snapshot();
    this.project.markers = this.project.markers.filter((m) => m.id !== markerId);
    this.emitChange('remove-marker');
  }

  renameMarker(markerId, label) {
    this.snapshot();
    const marker = this.project.markers.find((m) => m.id === markerId);
    if (marker) marker.label = label;
    this.emitChange('rename-marker');
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** クリップの再生範囲について、おおよそのRMS音量をdBで見積もる */
function estimateRmsDb(audioBuffer, offsetSec, durationSec) {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(offsetSec * sr));
  const endSample = Math.min(audioBuffer.length, Math.floor((offsetSec + durationSec) * sr));
  if (endSample <= startSample) return NaN;

  // 長い曲だと重いので、最大 10 秒分だけ間引いてサンプリングする
  const maxSamples = sr * 10;
  const totalSamples = endSample - startSample;
  const step = Math.max(1, Math.floor(totalSamples / maxSamples));

  let sumSquares = 0;
  let count = 0;
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = startSample; i < endSample; i += step) {
      const v = data[i];
      sumSquares += v * v;
      count++;
    }
  }
  if (count === 0) return NaN;
  const rms = Math.sqrt(sumSquares / count);
  if (rms <= 0) return -60;
  return 20 * Math.log10(rms);
}
