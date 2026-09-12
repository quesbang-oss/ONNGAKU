// アプリ全体で使う定数をここにまとめる。
// マジックナンバーを各所に散らさないための単一の置き場所。

export const APP_NAME = 'BunkaMix';
export const PROJECT_FILE_EXTENSION = '.bunkamix';
export const PROJECT_FILE_VERSION = 1;

export const ACCEPTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm'];

export const TRACK_TYPE = {
  BGM: 'bgm',
  SFX: 'sfx'
};

export const TRACK_TYPE_LABEL = {
  [TRACK_TYPE.BGM]: '🎵 BGM',
  [TRACK_TYPE.SFX]: '🔊 効果音'
};

export const PIXELS_PER_SECOND_DEFAULT = 40;
export const PIXELS_PER_SECOND_MIN = 5;
export const PIXELS_PER_SECOND_MAX = 400;
export const ZOOM_STEP_FACTOR = 1.3;
export const TRACK_HEIGHT = 88;
export const TRACK_HEADER_WIDTH = 120;
export const RULER_HEIGHT = 28;
export const WAVEFORM_PEAK_SAMPLES_PER_SECOND = 100;

export const DB_MIN = -40;
export const DB_MAX = 12;
export const DB_SILENT_THRESHOLD = -39.9;

export const EXPORT_SAMPLE_RATE = 44100;
export const EXPORT_BIT_DEPTH = 16;
export const EXPORT_CHANNELS = 2;

export const AUTOSAVE_INTERVAL_MS = 30000;
export const AUTOSAVE_DB_NAME = 'bunkamix-db';
export const AUTOSAVE_DB_VERSION = 1;
export const AUTOSAVE_STORE_PROJECT = 'autosave-project';
export const AUTOSAVE_STORE_MEDIA = 'media';

export const UNDO_HISTORY_LIMIT = 60;

export const MARKER_PRESETS = [
  { icon: '⭐', label: 'サビ開始' },
  { icon: '🔊', label: '効果音' },
  { icon: '💃', label: '振り付け変更' },
  { icon: '🎬', label: '曲変更' },
  { icon: '🎤', label: 'MC開始' }
];

export const CLIP_COLORS = {
  [TRACK_TYPE.BGM]: '#4C7CF3',
  [TRACK_TYPE.SFX]: '#F39C4C'
};

export const DEFAULT_COUNTDOWN_SECONDS = 5;
export const TOAST_DURATION_MS = 3200;
