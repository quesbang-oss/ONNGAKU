import {
  AUTOSAVE_DB_NAME,
  AUTOSAVE_DB_VERSION,
  AUTOSAVE_STORE_PROJECT,
  AUTOSAVE_STORE_MEDIA,
  AUTOSAVE_INTERVAL_MS
} from '../utils/constants.js';
import { Project } from './ProjectManager.js';
import { computePeaks } from '../audio/WaveformRenderer.js';

/**
 * IndexedDB を使った自動バックアップ機構。
 * 一定間隔でプロジェクトの状態と、使用中の音声データ（ArrayBuffer）を保存し、
 * 次回起動時に「前回の編集データを復元しますか？」と案内できるようにする。
 */
export class BackupManager {
  constructor(audioLibrary) {
    this.audioLibrary = audioLibrary;
    this.db = null;
    this.timer = null;
    this.available = true;
  }

  async open() {
    if (!('indexedDB' in window)) {
      this.available = false;
      return false;
    }
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(AUTOSAVE_DB_NAME, AUTOSAVE_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(AUTOSAVE_STORE_PROJECT)) {
            db.createObjectStore(AUTOSAVE_STORE_PROJECT);
          }
          if (!db.objectStoreNames.contains(AUTOSAVE_STORE_MEDIA)) {
            db.createObjectStore(AUTOSAVE_STORE_MEDIA);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return true;
    } catch (err) {
      console.error('IndexedDB を開けませんでした', err);
      this.available = false;
      return false;
    }
  }

  /** 一定間隔での自動保存を開始する。onSaved は保存成功時に呼ばれるコールバック（トースト表示用）。 */
  startAutoSave(getProject, onSaved) {
    if (!this.available) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(async () => {
      try {
        const project = getProject();
        if (!project) return;
        await this.saveNow(project);
        if (onSaved) onSaved();
      } catch (err) {
        console.error('自動バックアップに失敗しました', err);
      }
    }, AUTOSAVE_INTERVAL_MS);
  }

  stopAutoSave() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async saveNow(project) {
    if (!this.available || !this.db) return;
    const usedMediaIds = new Set();
    project.tracks.forEach((t) => t.clips.forEach((c) => usedMediaIds.add(c.mediaId)));

    await this._tx(AUTOSAVE_STORE_PROJECT, 'readwrite', (store) => {
      store.put({ project: project.toJSON(), mediaIds: Array.from(usedMediaIds), savedAt: Date.now() }, 'current');
    });

    await this._tx(AUTOSAVE_STORE_MEDIA, 'readwrite', (store) => {
      for (const mediaId of usedMediaIds) {
        const item = this.audioLibrary.get(mediaId);
        if (!item) continue;
        store.put({ name: item.name, mimeType: item.mimeType, arrayBuffer: item.arrayBuffer }, mediaId);
      }
    });
  }

  async hasBackup() {
    if (!this.available || !this.db) return false;
    const record = await this._get(AUTOSAVE_STORE_PROJECT, 'current');
    return !!record;
  }

  async getBackupInfo() {
    const record = await this._get(AUTOSAVE_STORE_PROJECT, 'current');
    if (!record) return null;
    return { savedAt: record.savedAt, trackCount: record.project.tracks.length };
  }

  /** バックアップからプロジェクトを復元し、AudioLibrary へも音声を再登録する。 */
  async restore(audioContext) {
    const record = await this._get(AUTOSAVE_STORE_PROJECT, 'current');
    if (!record) return null;

    for (const mediaId of record.mediaIds) {
      const mediaRecord = await this._get(AUTOSAVE_STORE_MEDIA, mediaId);
      if (!mediaRecord) continue;
      try {
        const decodeBuffer = mediaRecord.arrayBuffer.slice(0);
        const audioBuffer = await audioContext.decodeAudioData(decodeBuffer);
        const peaks = computePeaks(audioBuffer);
        this.audioLibrary.registerWithId(mediaId, {
          name: mediaRecord.name,
          mimeType: mediaRecord.mimeType,
          arrayBuffer: mediaRecord.arrayBuffer,
          audioBuffer,
          peaks
        });
      } catch (err) {
        console.error('バックアップ音声のデコードに失敗しました', mediaId, err);
      }
    }
    return Project.fromJSON(record.project);
  }

  async clear() {
    if (!this.available || !this.db) return;
    await this._tx(AUTOSAVE_STORE_PROJECT, 'readwrite', (store) => store.clear());
    await this._tx(AUTOSAVE_STORE_MEDIA, 'readwrite', (store) => store.clear());
  }

  _tx(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      fn(store);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  _get(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
}
