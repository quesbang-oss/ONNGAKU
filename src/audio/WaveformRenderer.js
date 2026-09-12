import { WAVEFORM_PEAK_SAMPLES_PER_SECOND } from '../utils/constants.js';

/**
 * AudioBuffer から波形の「ピークデータ」（min/max の配列）を事前計算する。
 * ズームレベルが変わっても再デコードせずに済むよう、
 * 決まった密度（1秒あたり WAVEFORM_PEAK_SAMPLES_PER_SECOND 点）で保持し、
 * 描画時に必要な範囲だけを間引き／補間して使う。
 */
export function computePeaks(audioBuffer, samplesPerSecond = WAVEFORM_PEAK_SAMPLES_PER_SECOND) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const totalPoints = Math.max(1, Math.ceil((length / audioBuffer.sampleRate) * samplesPerSecond));
  const blockSize = Math.max(1, Math.floor(length / totalPoints));

  const min = new Float32Array(totalPoints);
  const max = new Float32Array(totalPoints);

  // 複数チャンネルはミックスして1本の波形として扱う（表示用途のため十分）
  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c));

  for (let i = 0; i < totalPoints; i++) {
    const start = i * blockSize;
    const end = Math.min(length, start + blockSize);
    let blockMin = 1;
    let blockMax = -1;
    for (let j = start; j < end; j++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += channelData[c][j];
      const v = sum / channels;
      if (v < blockMin) blockMin = v;
      if (v > blockMax) blockMax = v;
    }
    if (end === start) {
      blockMin = 0;
      blockMax = 0;
    }
    min[i] = blockMin;
    max[i] = blockMax;
  }

  return { min, max, samplesPerSecond };
}

/**
 * Canvas 2D コンテキストへ波形を描画する。
 * region はソースバッファ内での [startSec, endSec) を指す（クリップのトリミングに対応するため）。
 */
export function drawWaveform(ctx, peaks, { x, y, width, height, startSec, endSec, color }) {
  if (!peaks || width <= 0 || height <= 0) return;
  const { min, max, samplesPerSecond } = peaks;
  const totalPoints = min.length;
  const startIdx = Math.max(0, Math.floor(startSec * samplesPerSecond));
  const endIdx = Math.min(totalPoints, Math.ceil(endSec * samplesPerSecond));
  const visiblePoints = Math.max(1, endIdx - startIdx);
  const midY = y + height / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  // 表示ピクセル数より点数が多い場合は間引き、少ない場合は補間して描画する
  for (let px = 0; px < width; px++) {
    const t0 = startIdx + (px / width) * visiblePoints;
    const t1 = startIdx + ((px + 1) / width) * visiblePoints;
    const i0 = Math.max(startIdx, Math.floor(t0));
    const i1 = Math.min(endIdx, Math.max(i0 + 1, Math.ceil(t1)));
    let blockMin = 1;
    let blockMax = -1;
    for (let i = i0; i < i1; i++) {
      if (min[i] < blockMin) blockMin = min[i];
      if (max[i] > blockMax) blockMax = max[i];
    }
    if (blockMax < blockMin) {
      blockMin = 0;
      blockMax = 0;
    }
    const yMin = midY - blockMax * (height / 2) * 0.9;
    const yMax = midY - blockMin * (height / 2) * 0.9;
    ctx.fillRect(x + px, yMin, 1, Math.max(1, yMax - yMin));
  }
  ctx.restore();
}
