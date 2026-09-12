import { AudioLibrary } from './audio/AudioLibrary.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { AudioImporter } from './audio/AudioImporter.js';
import { AudioExporter } from './audio/AudioExporter.js';
import { ProjectManager } from './project/ProjectManager.js';
import { ProjectSerializer } from './project/ProjectSerializer.js';
import { BackupManager } from './project/BackupManager.js';
import { Timeline } from './timeline/Timeline.js';
import { TimelineSelection } from './timeline/TimelineSelection.js';
import { MarkerManager } from './timeline/MarkerManager.js';
import { SetlistPanel } from './ui/SetlistPanel.js';
import { Toolbar } from './ui/Toolbar.js';
import { TransportControls } from './ui/TransportControls.js';
import { ExportDialog } from './ui/ExportDialog.js';
import { PerformanceMode } from './ui/PerformanceMode.js';
import { downloadBlob, isAcceptedAudioFile } from './utils/fileUtils.js';
import { formatTimeShort } from './utils/formatTime.js';
import { TRACK_TYPE, MARKER_PRESETS, TOAST_DURATION_MS, PROJECT_FILE_EXTENSION } from './utils/constants.js';

// ---------------------------------------------------------------
// 基盤オブジェクトの組み立て
// ---------------------------------------------------------------

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const audioLibrary = new AudioLibrary();
const projectManager = new ProjectManager(audioLibrary);
const engine = new AudioEngine(audioContext, audioLibrary);
const importer = new AudioImporter(audioContext, audioLibrary);
const exporter = new AudioExporter(audioLibrary);
const serializer = new ProjectSerializer(audioLibrary);
const backupManager = new BackupManager(audioLibrary);
const selection = new TimelineSelection();

let currentFileHandle = null; // File System Access API を使える場合の「上書き保存」先

function resumeAudioContextOnce() {
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
}
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, resumeAudioContextOnce, { once: false }));

// ---------------------------------------------------------------
// トースト通知
// ---------------------------------------------------------------

const toastContainer = document.getElementById('toast-container');
function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type && type !== 'info' ? ` ${type}` : ''}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), TOAST_DURATION_MS);
}

window.addEventListener('error', (e) => {
  console.error('未処理のエラー', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('未処理のPromiseエラー', e.reason);
});

// ---------------------------------------------------------------
// ダークモード
// ---------------------------------------------------------------

const appEl = document.getElementById('app');
function applyTheme(theme) {
  appEl.dataset.theme = theme;
  localStorage.setItem('bunkamix-theme', theme);
}
applyTheme(localStorage.getItem('bunkamix-theme') || 'light');

// ---------------------------------------------------------------
// タイムライン
// ---------------------------------------------------------------

const timeline = new Timeline({
  dropzoneEl: document.getElementById('timeline-dropzone'),
  rulerEl: document.getElementById('ruler'),
  tracksContainerEl: document.getElementById('tracks-container'),
  emptyStateEl: document.getElementById('empty-state'),
  selection,
  getProject: () => projectManager.project,
  getAudioLibrary: () => audioLibrary,
  callbacks: {
    onFilesDropped: (files, trackType, atTime) => handleFilesDropped(files, trackType, atTime),
    onDragStart: () => projectManager.snapshot(),
    onClipMove: (clipId, newStart) => projectManager.moveClip(clipId, newStart, { skipSnapshot: true }),
    onClipTrim: (clipId, patch) => projectManager.commitClipTrim(clipId, patch),
    onSeek: (time) => engine.seek(time),
    onSelect: (clipId) => syncClipToolbarFromSelection(clipId),
    onRenameClip: (clipId, name) => projectManager.renameClip(clipId, name),
    onTrackMuteToggle: (trackType) => {
      const track = projectManager.project.tracks.find((t) => t.type === trackType);
      projectManager.setTrackMuted(trackType, !track.muted);
    },
    onTrackVolumeChange: (trackType, db) => projectManager.setTrackVolume(trackType, db)
  }
});

const dropzoneEl = document.getElementById('timeline-dropzone');
const tracksContainerEl = document.getElementById('tracks-container');

const markerManager = new MarkerManager({
  trackContainerEl: dropzoneEl,
  markerListEl: document.getElementById('marker-list'),
  pixelsPerSecondGetter: () => timeline.pixelsPerSecond,
  onSeek: (time) => engine.seek(time),
  onRemove: (markerId) => projectManager.removeMarker(markerId)
});
// マーカー行はルーラーの直下・トラック一覧の直前に表示する
dropzoneEl.insertBefore(markerManager.rowEl, tracksContainerEl);

const setlistPanel = new SetlistPanel({
  listEl: document.getElementById('setlist-list'),
  selection,
  onReorder: (order) => projectManager.reorderSetlist(order),
  onSelect: (clipId) => {
    selection.select(clipId);
    syncClipToolbarFromSelection(clipId);
  },
  onRename: (clipId, name) => projectManager.renameClip(clipId, name)
});

// ---------------------------------------------------------------
// ファイル取り込み（ドラッグ＆ドロップ／「音源を追加」ボタン共通）
// ---------------------------------------------------------------

async function handleFilesDropped(files, trackType, atTime) {
  const accepted = files.filter(isAcceptedAudioFile);
  const rejected = files.length - accepted.length;
  if (rejected > 0) {
    showToast(`対応していない形式のファイルが${rejected}件ありました（MP3/WAV/OGG/M4A/AAC/WebMのみ対応）。`, 'warn');
  }
  if (accepted.length === 0) return;

  showToast(`${accepted.length}件の音源を読み込んでいます…`, 'info');
  const { results, errors } = await importer.importFiles(accepted);

  let placeAt = atTime;
  for (const meta of results) {
    projectManager.addClipFromMedia(trackType, meta, { start: placeAt });
    if (placeAt != null) placeAt += meta.duration; // 続けて配置した場合は連続で並べる
  }

  if (errors.length) {
    for (const { file, error } of errors) {
      console.error('音声インポートエラー', file.name, error);
      showToast(error.userMessage || `「${file.name}」の読み込みに失敗しました。`, 'error');
    }
  }
  if (results.length) showToast(`${results.length}件の音源を追加しました。`, 'success');
}

// 「🎵 音源を追加」ボタン用の隠しファイル選択
const importInput = document.createElement('input');
importInput.type = 'file';
importInput.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm';
importInput.multiple = true;
importInput.style.display = 'none';
document.body.appendChild(importInput);
importInput.addEventListener('change', () => {
  const files = Array.from(importInput.files || []);
  importInput.value = '';
  if (files.length) handleFilesDropped(files, TRACK_TYPE.BGM, null);
});

// プロジェクトを開く用の隠しファイル選択
const openInput = document.createElement('input');
openInput.type = 'file';
openInput.accept = PROJECT_FILE_EXTENSION;
openInput.style.display = 'none';
document.body.appendChild(openInput);
openInput.addEventListener('change', async () => {
  const file = openInput.files && openInput.files[0];
  openInput.value = '';
  if (!file) return;
  await openProjectFile(file);
});

async function openProjectFile(file) {
  try {
    resumeAudioContextOnce();
    const text = await file.text();
    const { project, missingMedia } = await serializer.parseFile(text, audioContext);
    projectManager.loadProject(project);
    currentFileHandle = null;
    if (missingMedia.length) {
      showToast(`${missingMedia.length}件の音源データが見つかりませんでした（軽量保存されたファイルの可能性があります）。`, 'warn');
    } else {
      showToast('プロジェクトを開きました。', 'success');
    }
  } catch (err) {
    console.error('プロジェクト読み込みエラー', err);
    showToast(err.message || 'プロジェクトの読み込みに失敗しました。', 'error');
  }
}

// ---------------------------------------------------------------
// ツールバー（新規／開く／保存／取り込み／Undo・Redo／自動調整／ヘルプ／テーマ／書き出し／本番モード）
// ---------------------------------------------------------------

const helpModal = document.getElementById('help-modal');

const toolbar = new Toolbar({
  onNew: () => {
    if (projectManager.project.tracks.some((t) => t.clips.length)) {
      if (!window.confirm('現在の編集内容は失われます。新規プロジェクトを作成しますか？')) return;
    }
    projectManager.newProject();
    currentFileHandle = null;
    showToast('新規プロジェクトを作成しました。');
  },
  onOpen: () => openInput.click(),
  onSave: () => saveProject({ askName: false }),
  onSaveAs: () => saveProject({ askName: true }),
  onImport: () => importInput.click(),
  onUndo: () => projectManager.undo(),
  onRedo: () => projectManager.redo(),
  onNormalize: () => {
    const ok = projectManager.normalizeBgmVolumes();
    showToast(ok ? '曲ごとの音量差を自動調整しました。' : '調整対象のBGMがありません。', ok ? 'success' : 'warn');
  },
  onHelp: () => { helpModal.hidden = false; },
  onThemeToggle: () => applyTheme(appEl.dataset.theme === 'dark' ? 'light' : 'dark'),
  onExport: () => exportDialog.open(),
  onPerform: () => performanceMode.show()
});

document.getElementById('btn-help-close').addEventListener('click', () => { helpModal.hidden = true; });

async function saveProject({ askName }) {
  const project = projectManager.project;
  if (askName) {
    const name = window.prompt('プロジェクト名', project.name);
    if (name == null) return;
    if (name.trim()) project.name = name.trim();
  }
  try {
    const blob = serializer.buildFileBlob(project, { embedAudio: true });
    downloadBlob(blob, serializer.suggestFileName(project));
    showToast('プロジェクトを保存しました。', 'success');
  } catch (err) {
    console.error('保存エラー', err);
    showToast('保存に失敗しました。音声データが大きすぎる可能性があります。', 'error');
  }
}

// ---------------------------------------------------------------
// タイムライン編集ツールバー（分割・削除・複製・フェード・音量・クロスフェード・曲間・ズーム）
// ---------------------------------------------------------------

const btnSplit = document.getElementById('btn-split');
const btnDeleteClip = document.getElementById('btn-delete-clip');
const btnDuplicateClip = document.getElementById('btn-duplicate-clip');
const fadeInInput = document.getElementById('fade-in-input');
const fadeOutInput = document.getElementById('fade-out-input');
const clipVolumeInput = document.getElementById('clip-volume-input');
const crossfadeSelect = document.getElementById('crossfade-select');
const gapSelect = document.getElementById('gap-select');
const gapCustomInput = document.getElementById('gap-custom-input');
const btnApplyGap = document.getElementById('btn-apply-gap');

btnSplit.addEventListener('click', () => {
  const id = selection.selectedClipId;
  if (!id) return showToast('分割するクリップを選択してください。', 'warn');
  const result = projectManager.splitClip(id, engine.getCurrentTime());
  if (!result) showToast('再生ヘッドがクリップの範囲内にありません。', 'warn');
});

btnDeleteClip.addEventListener('click', () => {
  const id = selection.selectedClipId;
  if (!id) return showToast('削除するクリップを選択してください。', 'warn');
  projectManager.deleteClip(id);
  selection.clear();
});

btnDuplicateClip.addEventListener('click', () => {
  const id = selection.selectedClipId;
  if (!id) return showToast('複製するクリップを選択してください。', 'warn');
  const copy = projectManager.duplicateClip(id);
  if (copy) selection.select(copy.id);
});

fadeInInput.addEventListener('change', () => {
  const id = selection.selectedClipId;
  if (!id) return;
  projectManager.setClipFade(id, { fadeIn: Number(fadeInInput.value) || 0 });
});
fadeOutInput.addEventListener('change', () => {
  const id = selection.selectedClipId;
  if (!id) return;
  projectManager.setClipFade(id, { fadeOut: Number(fadeOutInput.value) || 0 });
});
clipVolumeInput.addEventListener('input', () => {
  const id = selection.selectedClipId;
  if (!id) return;
  projectManager.setClipVolume(id, Number(clipVolumeInput.value));
});

gapSelect.addEventListener('change', () => {
  gapCustomInput.style.display = gapSelect.value === 'custom' ? '' : 'none';
});

btnApplyGap.addEventListener('click', () => {
  const id = selection.selectedClipId;
  if (!id) return showToast('BGMトラックの曲を選択してください。', 'warn');
  const crossfade = Number(crossfadeSelect.value) || 0;
  if (crossfade > 0) {
    projectManager.applyCrossfadeAfterClip(id, crossfade);
    showToast(`${crossfade}秒のクロスフェードを適用しました。`, 'success');
    return;
  }
  const gapValue = gapSelect.value === 'custom' ? Number(gapCustomInput.value) || 0 : Number(gapSelect.value) || 0;
  projectManager.applyGapAfterClip(id, gapValue);
  showToast(`曲間に${gapValue}秒の無音を適用しました。`, 'success');
});

document.getElementById('btn-zoom-in').addEventListener('click', () => timeline.zoomIn());
document.getElementById('btn-zoom-out').addEventListener('click', () => timeline.zoomOut());

function syncClipToolbarFromSelection(clipId) {
  const { clip } = projectManager.project.findClip(clipId);
  if (!clip) return;
  fadeInInput.value = clip.fadeIn || 0;
  fadeOutInput.value = clip.fadeOut || 0;
  clipVolumeInput.value = clip.volumeDb || 0;
}

// ---------------------------------------------------------------
// マーカー追加
// ---------------------------------------------------------------

document.getElementById('btn-marker-add').addEventListener('click', () => {
  const time = engine.getCurrentTime();
  const presetList = MARKER_PRESETS.map((p, i) => `${i + 1}: ${p.icon} ${p.label}`).join('\n');
  const input = window.prompt(
    `マーカーを追加します（現在位置 ${formatTimeShort(time)}）\n番号を選ぶか、自由に名前を入力してください:\n${presetList}`,
    '1'
  );
  if (input == null || !input.trim()) return;
  const idx = Number(input.trim()) - 1;
  const preset = Number.isInteger(idx) ? MARKER_PRESETS[idx] : null;
  const icon = preset ? preset.icon : '📍';
  const label = preset ? preset.label : input.trim();
  projectManager.addMarker({ time, icon, label });
});

// ---------------------------------------------------------------
// トランスポート（再生・停止・音量）
// ---------------------------------------------------------------

const transport = new TransportControls({
  onPlay: () => {
    resumeAudioContextOnce();
    engine.play(projectManager.project, engine.pausedAt);
    transport.setPlayingState(true);
  },
  onPause: () => {
    engine.pause();
    transport.setPlayingState(false);
  },
  onStop: () => {
    engine.stop();
    transport.setPlayingState(false);
    timeline.setPlayheadTime(0);
  },
  onHome: () => engine.seek(0),
  onEnd: () => engine.seek(projectManager.project.duration),
  onMasterVolumeChange: (db) => projectManager.setMasterVolume(db),
  onBgmVolumeChange: (db) => projectManager.setTrackVolume(TRACK_TYPE.BGM, db),
  onSfxVolumeChange: (db) => projectManager.setTrackVolume(TRACK_TYPE.SFX, db),
  onMuteToggle: (muted) => projectManager.setMasterMuted(muted)
});

engine.onTimeUpdate((t) => {
  transport.updateTime(t, projectManager.project.duration);
  timeline.setPlayheadTime(t);
});
engine.onEnded(() => transport.setPlayingState(false));

// ---------------------------------------------------------------
// 書き出し・本番モード
// ---------------------------------------------------------------

const exportDialog = new ExportDialog({
  exporter,
  getProject: () => projectManager.project,
  showToast
});

const performanceMode = new PerformanceMode({
  engine,
  getProject: () => projectManager.project,
  onExit: () => {}
});

// ---------------------------------------------------------------
// プロジェクト変更時の再描画
// ---------------------------------------------------------------

function renderAll() {
  const project = projectManager.project;
  engine.setMasterVolume(project.masterVolumeDb, project.masterMuted);
  engine.setTrackVolume(TRACK_TYPE.BGM, project.bgmTrack.volumeDb, project.bgmTrack.muted);
  engine.setTrackVolume(TRACK_TYPE.SFX, project.sfxTrack.volumeDb, project.sfxTrack.muted);

  timeline.render();
  setlistPanel.render(project);
  markerManager.render(project.markers);
  transport.syncVolumeSliders(project);
  transport.updateTime(engine.getCurrentTime(), project.duration);
  toolbar.setUndoRedoEnabled(projectManager.canUndo(), projectManager.canRedo());

  // 使われなくなった音声データを間引いてメモリを節約する
  const usedIds = new Set();
  project.tracks.forEach((t) => t.clips.forEach((c) => usedIds.add(c.mediaId)));
  audioLibrary.pruneUnused(usedIds);
}

projectManager.addEventListener('change', renderAll);
renderAll();

// ---------------------------------------------------------------
// キーボードショートカット
// ---------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  const isTyping = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); projectManager.undo(); return; }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); projectManager.redo(); return; }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); saveProject({ askName: false }); return; }
    if (e.key.toLowerCase() === 'o') { e.preventDefault(); openInput.click(); return; }
    return;
  }

  if (isTyping) return;

  if (e.key === ' ') {
    e.preventDefault();
    if (engine.isPlaying) {
      engine.pause();
      transport.setPlayingState(false);
    } else {
      resumeAudioContextOnce();
      engine.play(projectManager.project, engine.pausedAt);
      transport.setPlayingState(true);
    }
  } else if (e.key.toLowerCase() === 's') {
    btnSplit.click();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selection.selectedClipId) btnDeleteClip.click();
  } else if (e.key === 'Home') {
    engine.seek(0);
  } else if (e.key === 'End') {
    engine.seek(projectManager.project.duration);
  } else if (e.key === '+' || e.key === '=') {
    timeline.zoomIn();
  } else if (e.key === '-' || e.key === '_') {
    timeline.zoomOut();
  }
});

// ---------------------------------------------------------------
// 自動バックアップ・復元
// ---------------------------------------------------------------

const restoreModal = document.getElementById('restore-modal');
const restoreInfo = document.getElementById('restore-info');

(async function initBackup() {
  const opened = await backupManager.open();
  if (!opened) {
    showToast('このブラウザでは自動バックアップ機能を利用できません。', 'warn');
    return;
  }
  const hasBackup = await backupManager.hasBackup();
  if (hasBackup) {
    const info = await backupManager.getBackupInfo();
    const when = info ? new Date(info.savedAt).toLocaleString('ja-JP') : '';
    restoreInfo.textContent = when ? `保存日時: ${when}` : '';
    restoreModal.hidden = false;
  }
  backupManager.startAutoSave(
    () => projectManager.project,
    () => showToast('自動保存しました。')
  );
})();

document.getElementById('btn-restore-confirm').addEventListener('click', async () => {
  restoreModal.hidden = true;
  try {
    const project = await backupManager.restore(audioContext);
    if (project) {
      projectManager.loadProject(project);
      showToast('前回の編集データを復元しました。', 'success');
    }
  } catch (err) {
    console.error('復元エラー', err);
    showToast('復元に失敗しました。', 'error');
  }
});

document.getElementById('btn-restore-discard').addEventListener('click', async () => {
  restoreModal.hidden = true;
  await backupManager.clear();
});

// ページを閉じる直前にも保存を試みる（ベストエフォート）
window.addEventListener('beforeunload', () => {
  backupManager.saveNow(projectManager.project).catch(() => {});
});
