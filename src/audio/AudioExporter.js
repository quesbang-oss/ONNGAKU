import { TRACK_TYPE, EXPORT_SAMPLE_RATE, EXPORT_CHANNELS } from '../utils/constants.js';
import { dbToGain } from './AudioEngine.js';
import { sanitizeFileName } from '../utils/formatTime.js';

/**
 * OfflineAudioContext を使って、プロジェクト（または1曲分）を
 * 44.1kHz / 16bit / ステレオの WAV として書き出す。
 */
export class AudioExporter {
  constructor(audioLibrary) {
    this.audioLibrary = audioLibrary;
  }

  /** プロジェクト全体をCD用WAVとして書き出す */
  async exportProjectToWav(project, { onProgress } = {}) {
    const duration = Math.max(0.1, project.duration + 1);
    const renderedBuffer = await this._renderRange(project, 0, duration, onProgress);
    return audioBufferToWavBlob(renderedBuffer);
  }

  /** セットリストの1曲だけを、その曲の長さぶんだけ書き出す */
  async exportClipToWav(clip, { onProgress } = {}) {
    const media = this.audioLibrary.get(clip.mediaId);
    if (!media) throw new Error(`「${clip.name}」の音声データが見つかりません。`);

    const offlineCtx = new OfflineAudioContext(
      EXPORT_CHANNELS,
      Math.ceil(clip.duration * EXPORT_SAMPLE_RATE),
      EXPORT_SAMPLE_RATE
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = media.audioBuffer;
    const gainNode = offlineCtx.createGain();
    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    applyClipGainAutomation(gainNode, clip, 0, 0);

    source.start(0, clip.trimStart, clip.duration);
    if (onProgress) onProgress(0.3);
    const rendered = await offlineCtx.startRendering();
    if (onProgress) onProgress(1);
    return audioBufferToWavBlob(rendered);
  }

  /** セットリストの全曲をそれぞれ書き出す（ファイル名の配列付きで返す） */
  async exportAllTracksSeparately(project, { onProgress } = {}) {
    const items = project.setlistItems;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      const { clip, index } = items[i];
      const blob = await this.exportClipToWav(clip);
      const numberLabel = String(index).padStart(2, '0');
      const filename = `${numberLabel}_${sanitizeFileName(clip.setlistLabel || clip.name)}.wav`;
      files.push({ filename, blob });
      if (onProgress) onProgress((i + 1) / items.length);
    }
    return files;
  }

  async _renderRange(project, fromTime, toTime, onProgress) {
    const durationSamples = Math.ceil((toTime - fromTime) * EXPORT_SAMPLE_RATE);
    const offlineCtx = new OfflineAudioContext(EXPORT_CHANNELS, Math.max(1, durationSamples), EXPORT_SAMPLE_RATE);

    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = project.masterMuted ? 0 : dbToGain(project.masterVolumeDb);
    masterGain.connect(offlineCtx.destination);

    const trackGains = {};
    for (const type of [TRACK_TYPE.BGM, TRACK_TYPE.SFX]) {
      const g = offlineCtx.createGain();
      trackGains[type] = g;
      g.connect(masterGain);
    }

    let scheduled = 0;
    for (const track of project.tracks) {
      trackGains[track.type].gain.value = track.muted ? 0 : dbToGain(track.volumeDb);
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.muted) continue;
        if (clip.end <= fromTime || clip.start >= toTime) continue;
        const media = this.audioLibrary.get(clip.mediaId);
        if (!media || !media.audioBuffer) continue;

        const offsetIntoClip = Math.max(0, fromTime - clip.start);
        const whenToStart = Math.max(0, clip.start - fromTime);
        const sourceOffset = clip.trimStart + offsetIntoClip;
        const playDuration = clip.duration - offsetIntoClip;
        if (playDuration <= 0.001) continue;

        const source = offlineCtx.createBufferSource();
        source.buffer = media.audioBuffer;
        const gainNode = offlineCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(trackGains[track.type]);
        applyClipGainAutomation(gainNode, clip, whenToStart, offsetIntoClip);
        source.start(whenToStart, sourceOffset, playDuration);
        scheduled++;
      }
    }

    if (onProgress) onProgress(0.15);
    const rendered = await offlineCtx.startRendering();
    if (onProgress) onProgress(1);
    return rendered;
  }
}

function applyClipGainAutomation(gainNode, clip, t0, offsetIntoClip) {
  const baseGain = dbToGain(clip.volumeDb);
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
    const startAt = fadeOutStartRelative > 0 ? t0 + fadeOutStartRelative : t0 + 0.001;
    gainNode.gain.setValueAtTime(baseGain, startAt);
    const fadeOutEndRelative = clipDuration - offsetIntoClip;
    gainNode.gain.linearRampToValueAtTime(0.0001, t0 + Math.min(fadeOutEndRelative, (fadeOutStartRelative > 0 ? fadeOutStartRelative : 0.001) + fadeOut));
  }
}

/** AudioBuffer を 16bit PCM WAV の Blob に変換する */
export function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmtチャンクサイズ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // バイトレート
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // ビット深度
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let c = 0; c < numChannels; c++) channelData.push(audioBuffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channelData[c][i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
