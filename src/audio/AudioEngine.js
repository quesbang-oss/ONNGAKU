import { TRACK_TYPE } from '../utils/constants.js';

/** dB を線形ゲイン値に変換する */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

/**
 * Web Audio API を使った再生エンジン。
 * プロジェクトのトラック／クリップ構造を受け取り、正しいタイミングで
 * AudioBufferSourceNode をスケジュールする。
 *
 * ノード構成:
 *   各クリップの source -> clipGain(音量+フェード) -> trackGain(BGM/効果音) -> masterGain -> destination
 */
export class AudioEngine {
  constructor(audioContext, audioLibrary) {
    this.ctx = audioContext;
    this.audioLibrary = audioLibrary;

    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    this.trackGains = {
      [TRACK_TYPE.BGM]: this.ctx.createGain(),
      [TRACK_TYPE.SFX]: this.ctx.createGain()
    };
    this.trackGains[TRACK_TYPE.BGM].connect(this.masterGain);
    this.trackGains[TRACK_TYPE.SFX].connect(this.masterGain);

    this.isPlaying = false;
    this.playStartContextTime = 0;
    this.playStartOffset = 0;
    this.pausedAt = 0;
    this.activeNodes = [];
    this.rafId = null;
    this._timeUpdateListeners = [];
    this._endedListeners = [];
    this._project = null;
  }

  /** 複数の画面（通常編集画面・本番モード）が同時に時刻更新を購読できるようにする */
  onTimeUpdate(cb) {
    this._timeUpdateListeners.push(cb);
  }

  onEnded(cb) {
    this._endedListeners.push(cb);
  }

  _emitTimeUpdate(t) {
    for (const cb of this._timeUpdateListeners) cb(t);
  }

  _emitEnded() {
    for (const cb of this._endedListeners) cb();
  }

  setMasterVolume(db, muted) {
    this.masterGain.gain.value = muted ? 0 : dbToGain(db);
  }

  setTrackVolume(type, db, muted) {
    if (!this.trackGains[type]) return;
    this.trackGains[type].gain.value = muted ? 0 : dbToGain(db);
  }

  getDuration(project) {
    return project.duration;
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.pausedAt;
    return this.ctx.currentTime - this.playStartContextTime + this.playStartOffset;
  }

  /** 指定した時刻から再生を開始する */
  play(project, fromTime = null) {
    this._project = project;
    const startAt = fromTime != null ? fromTime : this.pausedAt;
    this._stopActiveNodes();

    const lookahead = 0.06;
    this.playStartContextTime = this.ctx.currentTime + lookahead;
    this.playStartOffset = Math.max(0, startAt);
    this.isPlaying = true;

    const duration = project.duration;

    for (const track of project.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.muted) continue;
        if (clip.end <= this.playStartOffset) continue; // 既に再生済みの範囲
        if (clip.start >= duration) continue;

        const media = this.audioLibrary.get(clip.mediaId);
        if (!media || !media.audioBuffer) continue;

        const offsetIntoClip = Math.max(0, this.playStartOffset - clip.start);
        const whenToStart = this.playStartContextTime + Math.max(0, clip.start - this.playStartOffset);
        const sourceOffset = clip.trimStart + offsetIntoClip;
        const playDuration = clip.duration - offsetIntoClip;
        if (playDuration <= 0.001) continue;

        this._scheduleClip({ track, clip, media, whenToStart, sourceOffset, playDuration, offsetIntoClip });
      }
    }

    this._startTimeLoop();
  }

  _scheduleClip({ track, clip, media, whenToStart, sourceOffset, playDuration, offsetIntoClip }) {
    const source = this.ctx.createBufferSource();
    source.buffer = media.audioBuffer;

    const gainNode = this.ctx.createGain();
    source.connect(gainNode);
    gainNode.connect(this.trackGains[track.type]);

    const baseGain = dbToGain(clip.volumeDb);

    // フェードイン・フェードアウトをゲインオートメーションで表現する。
    // すでにフェード区間の途中から再生を始める場合も自然に繋がるよう、
    // 現在時刻でのゲイン値から開始する。
    const t0 = whenToStart;
    gainNode.gain.cancelScheduledValues(t0);

    const fadeIn = clip.fadeIn || 0;
    const fadeOut = clip.fadeOut || 0;
    const clipDuration = clip.duration;

    if (fadeIn > 0 && offsetIntoClip < fadeIn) {
      const remainingFadeIn = fadeIn - offsetIntoClip;
      const currentRatio = offsetIntoClip / fadeIn;
      gainNode.gain.setValueAtTime(baseGain * currentRatio, t0);
      gainNode.gain.linearRampToValueAtTime(baseGain, t0 + remainingFadeIn);
    } else {
      gainNode.gain.setValueAtTime(baseGain, t0);
    }

    if (fadeOut > 0) {
      const fadeOutStartInClip = clipDuration - fadeOut;
      const fadeOutStartRelative = fadeOutStartInClip - offsetIntoClip;
      if (fadeOutStartRelative > 0) {
        gainNode.gain.setValueAtTime(baseGain, t0 + fadeOutStartRelative);
      }
      const fadeOutEndRelative = clipDuration - offsetIntoClip;
      gainNode.gain.linearRampToValueAtTime(0.0001, t0 + Math.max(fadeOutStartRelative, 0.001) + Math.min(fadeOut, fadeOutEndRelative));
    }

    source.start(whenToStart, sourceOffset, playDuration);
    this.activeNodes.push({ source, gainNode });
    source.onended = () => {
      this.activeNodes = this.activeNodes.filter((n) => n.source !== source);
    };
  }

  pause() {
    if (!this.isPlaying) return;
    this.pausedAt = this.getCurrentTime();
    this._stopActiveNodes();
    this.isPlaying = false;
    this._stopTimeLoop();
  }

  stop() {
    this._stopActiveNodes();
    this.isPlaying = false;
    this.pausedAt = 0;
    this._stopTimeLoop();
    this._emitTimeUpdate(0);
  }

  seek(time) {
    const wasPlaying = this.isPlaying;
    this.pausedAt = Math.max(0, time);
    if (wasPlaying) {
      this.play(this._project, this.pausedAt);
    } else {
      this._emitTimeUpdate(this.pausedAt);
    }
  }

  _stopActiveNodes() {
    for (const { source } of this.activeNodes) {
      try {
        source.onended = null;
        source.stop();
      } catch (err) {
        // すでに停止している場合は無視
      }
    }
    this.activeNodes = [];
  }

  _startTimeLoop() {
    this._stopTimeLoop();
    const tick = () => {
      if (!this.isPlaying) return;
      const t = this.getCurrentTime();
      const duration = this._project ? this._project.duration : 0;
      if (t >= duration && duration > 0) {
        this.stop();
        this._emitEnded();
        return;
      }
      this._emitTimeUpdate(t);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  _stopTimeLoop() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
