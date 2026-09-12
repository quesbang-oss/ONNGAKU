import { generateId } from '../utils/fileUtils.js';

/**
 * デコード済みの AudioBuffer と、書き出し・保存用に元の生バイト列を
 * メモリ上で一括管理するレジストリ。
 * Clip は bufferId だけを持ち、実データはここに問い合わせる。
 */
export class AudioLibrary {
  constructor() {
    /** @type {Map<string, {id:string, name:string, audioBuffer:AudioBuffer, arrayBuffer:ArrayBuffer, mimeType:string, peaks:{min:Float32Array,max:Float32Array,samplesPerSecond:number}}>} */
    this.items = new Map();
  }

  register({ name, audioBuffer, arrayBuffer, mimeType, peaks }) {
    const id = generateId('media');
    this.items.set(id, { id, name, audioBuffer, arrayBuffer, mimeType, peaks });
    return id;
  }

  /** 既存のIDで登録しなおす（プロジェクト読み込み時に使用） */
  registerWithId(id, data) {
    this.items.set(id, { id, ...data });
  }

  get(id) {
    return this.items.get(id) || null;
  }

  has(id) {
    return this.items.has(id);
  }

  remove(id) {
    this.items.delete(id);
  }

  /** そのメディアがどこかのクリップから参照されていなければ破棄してメモリを節約する */
  pruneUnused(usedIds) {
    for (const id of Array.from(this.items.keys())) {
      if (!usedIds.has(id)) this.items.delete(id);
    }
  }

  totalBytes() {
    let total = 0;
    for (const item of this.items.values()) {
      total += item.arrayBuffer ? item.arrayBuffer.byteLength : 0;
    }
    return total;
  }
}
