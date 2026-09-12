import { Project } from './ProjectManager.js';
import { PROJECT_FILE_VERSION, PROJECT_FILE_EXTENSION } from '../utils/constants.js';
import { computePeaks } from '../audio/WaveformRenderer.js';
import { sanitizeFileName } from '../utils/formatTime.js';

/**
 * プロジェクトを .bunkamix ファイル（JSONテキスト）へシリアライズ／デシリアライズする。
 * 音声データは可能な限りファイル自体に Base64 で埋め込み、
 * 他のPCへコピーしても音が鳴らせるようにする（要件21）。
 */
export class ProjectSerializer {
  constructor(audioLibrary) {
    this.audioLibrary = audioLibrary;
  }

  /** プロジェクトファイル（Blob）を作成する。embedAudio=false の場合は音声を含めない軽量版。 */
  buildFileBlob(project, { embedAudio = true } = {}) {
    const usedMediaIds = new Set();
    project.tracks.forEach((t) => t.clips.forEach((c) => usedMediaIds.add(c.mediaId)));

    const media = {};
    if (embedAudio) {
      for (const mediaId of usedMediaIds) {
        const item = this.audioLibrary.get(mediaId);
        if (!item) continue;
        media[mediaId] = {
          name: item.name,
          mimeType: item.mimeType,
          dataBase64: arrayBufferToBase64(item.arrayBuffer)
        };
      }
    } else {
      for (const mediaId of usedMediaIds) {
        const item = this.audioLibrary.get(mediaId);
        if (!item) continue;
        media[mediaId] = { name: item.name, mimeType: item.mimeType, dataBase64: null };
      }
    }

    const payload = {
      appName: 'BunkaMix',
      fileVersion: PROJECT_FILE_VERSION,
      savedAt: Date.now(),
      embedded: embedAudio,
      project: project.toJSON(),
      media
    };

    const json = JSON.stringify(payload);
    return new Blob([json], { type: 'application/json' });
  }

  suggestFileName(project) {
    return `${sanitizeFileName(project.name)}${PROJECT_FILE_EXTENSION}`;
  }

  /**
   * .bunkamix ファイルのテキストを読み込み、Project と AudioLibrary への登録を行う。
   * オーディオが埋め込まれていないクリップについては missingMedia として報告する。
   */
  async parseFile(text, audioContext) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw new Error('プロジェクトファイルの形式が正しくありません（JSONとして読み込めませんでした）。');
    }
    if (!payload || !payload.project) {
      throw new Error('プロジェクトファイルの内容が正しくありません。');
    }

    const missingMedia = [];
    for (const [mediaId, entry] of Object.entries(payload.media || {})) {
      if (!entry.dataBase64) {
        missingMedia.push({ mediaId, name: entry.name });
        continue;
      }
      try {
        const arrayBuffer = base64ToArrayBuffer(entry.dataBase64);
        const decodeBuffer = arrayBuffer.slice(0);
        const audioBuffer = await audioContext.decodeAudioData(decodeBuffer);
        const peaks = computePeaks(audioBuffer);
        this.audioLibrary.registerWithId(mediaId, {
          name: entry.name,
          mimeType: entry.mimeType,
          arrayBuffer,
          audioBuffer,
          peaks
        });
      } catch (err) {
        missingMedia.push({ mediaId, name: entry.name });
      }
    }

    const project = Project.fromJSON(payload.project);
    return { project, missingMedia };
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
