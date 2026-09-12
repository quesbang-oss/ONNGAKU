import { generateId } from '../utils/fileUtils.js';
import { AudioClip } from './AudioClip.js';

/** BGMトラック・効果音トラックなど、クリップの入れ物。 */
export class AudioTrack {
  constructor({ id = generateId('track'), type, name, volumeDb = 0, muted = false, clips = [] }) {
    this.id = id;
    this.type = type; // TRACK_TYPE.BGM | TRACK_TYPE.SFX
    this.name = name;
    this.volumeDb = volumeDb;
    this.muted = muted;
    /** @type {AudioClip[]} */
    this.clips = clips;
  }

  addClip(clip) {
    this.clips.push(clip);
    this.sortClips();
  }

  removeClip(clipId) {
    this.clips = this.clips.filter((c) => c.id !== clipId);
  }

  getClip(clipId) {
    return this.clips.find((c) => c.id === clipId) || null;
  }

  sortClips() {
    this.clips.sort((a, b) => a.start - b.start);
  }

  get duration() {
    return this.clips.reduce((max, c) => Math.max(max, c.end), 0);
  }

  toJSON() {
    const { id, type, name, volumeDb, muted, clips } = this;
    return { id, type, name, volumeDb, muted, clips: clips.map((c) => c.toJSON()) };
  }

  static fromJSON(json) {
    return new AudioTrack({ ...json, clips: (json.clips || []).map(AudioClip.fromJSON) });
  }
}
