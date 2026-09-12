import { readFileAsArrayBuffer } from '../utils/fileUtils.js';
import { computePeaks } from './WaveformRenderer.js';

/**
 * ファイル（File オブジェクト）を受け取り、
 * デコードして AudioLibrary へ登録し、メタ情報を返す。
 */
export class AudioImporter {
  constructor(audioContext, audioLibrary) {
    this.audioContext = audioContext;
    this.audioLibrary = audioLibrary;
  }

  /**
   * @param {File} file
   * @returns {Promise<{mediaId:string, name:string, duration:number, sampleRate:number, numberOfChannels:number}>}
   */
  async importFile(file) {
    let arrayBuffer;
    try {
      arrayBuffer = await readFileAsArrayBuffer(file);
    } catch (err) {
      throw new AppError('read-failed', `「${file.name}」の読み込みに失敗しました。`, err);
    }

    let audioBuffer;
    try {
      // decodeAudioData は ArrayBuffer を detach するため、書き出し用にコピーを保持しておく
      const copyForDecode = arrayBuffer.slice(0);
      audioBuffer = await this.audioContext.decodeAudioData(copyForDecode);
    } catch (err) {
      throw new AppError(
        'decode-failed',
        `「${file.name}」は音声として読み込めませんでした。ファイルが壊れているか、対応していない形式の可能性があります。`,
        err
      );
    }

    let peaks;
    try {
      peaks = computePeaks(audioBuffer);
    } catch (err) {
      // 波形が作れなくても再生自体はできるようにする
      peaks = { min: new Float32Array([0]), max: new Float32Array([0]), samplesPerSecond: 1 };
    }

    const mediaId = this.audioLibrary.register({
      name: file.name,
      audioBuffer,
      arrayBuffer,
      mimeType: file.type || 'application/octet-stream',
      peaks
    });

    return {
      mediaId,
      name: file.name,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels
    };
  }

  async importFiles(files) {
    const results = [];
    const errors = [];
    for (const file of files) {
      try {
        results.push(await this.importFile(file));
      } catch (err) {
        errors.push({ file, error: err });
      }
    }
    return { results, errors };
  }
}

export class AppError extends Error {
  constructor(code, userMessage, cause) {
    super(userMessage);
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}
