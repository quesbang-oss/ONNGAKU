import { generateId } from '../utils/fileUtils.js';

/**
 * タイムライン上に置かれる1つの音声クリップ。
 * 実際の音声データそのものは持たず、AudioLibrary の mediaId で参照する
 * （同じ音声を複製・分割しても元データを複製しないため軽量）。
 */
export class AudioClip {
  constructor({
    id = generateId('clip'),
    mediaId,
    name,
    start = 0,           // タイムライン上の開始位置（秒）
    trimStart = 0,        // 元データ内でのトリミング開始位置（秒）
    duration,             // クリップとして再生される長さ（秒）
    sourceDuration,       // 元データ全体の長さ（秒）
    volumeDb = 0,
    fadeIn = 0,
    fadeOut = 0,
    muted = false,
    color = null,
    setlistLabel = null,   // セットリストの曲名として表示する場合のラベル
    gapAfter = 0,          // このクリップの後に置く無音時間（秒、BGMトラックのみ使用）
    crossfadeWithNext = 0  // 次のクリップとのクロスフェード時間（秒、BGMトラックのみ使用）
  }) {
    this.id = id;
    this.mediaId = mediaId;
    this.name = name;
    this.start = start;
    this.trimStart = trimStart;
    this.duration = duration;
    this.sourceDuration = sourceDuration ?? duration;
    this.volumeDb = volumeDb;
    this.fadeIn = fadeIn;
    this.fadeOut = fadeOut;
    this.muted = muted;
    this.color = color;
    this.setlistLabel = setlistLabel;
    this.gapAfter = gapAfter;
    this.crossfadeWithNext = crossfadeWithNext;
  }

  get end() {
    return this.start + this.duration;
  }

  clone(overrides = {}) {
    return new AudioClip({ ...this, id: generateId('clip'), ...overrides });
  }

  toJSON() {
    const { id, mediaId, name, start, trimStart, duration, sourceDuration, volumeDb, fadeIn, fadeOut, muted, color, setlistLabel, gapAfter, crossfadeWithNext } = this;
    return { id, mediaId, name, start, trimStart, duration, sourceDuration, volumeDb, fadeIn, fadeOut, muted, color, setlistLabel, gapAfter, crossfadeWithNext };
  }

  static fromJSON(json) {
    return new AudioClip(json);
  }
}
