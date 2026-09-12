import { downloadBlob } from '../utils/fileUtils.js';
import { sanitizeFileName } from '../utils/formatTime.js';

/** 「💿 書き出し」モーダルの表示・操作を担当する。 */
export class ExportDialog {
  constructor({ exporter, getProject, showToast }) {
    this.exporter = exporter;
    this.getProject = getProject;
    this.showToast = showToast;
    this.overlay = document.getElementById('export-modal');
    this.progressWrap = document.getElementById('export-progress');
    this.progressBar = document.getElementById('export-progress-bar');
    this.progressLabel = document.getElementById('export-progress-label');

    document.getElementById('btn-export-close').addEventListener('click', () => this.close());
    document.getElementById('btn-export-cd').addEventListener('click', () => this._exportCd());
    document.getElementById('btn-export-tracks').addEventListener('click', () => this._exportTracksIndividually());
    document.getElementById('btn-export-tracks-zip').addEventListener('click', () => this._exportTracksZip());
  }

  open() {
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
    this.progressWrap.hidden = true;
  }

  _setProgress(ratio, label) {
    this.progressWrap.hidden = false;
    this.progressBar.style.width = `${Math.round(ratio * 100)}%`;
    if (label) this.progressLabel.textContent = label;
  }

  async _exportCd() {
    const project = this.getProject();
    if (project.duration <= 0) {
      this.showToast('書き出す音源がありません。先に曲を追加してください。', 'warn');
      return;
    }
    try {
      this._setProgress(0.05, 'CD用WAVを書き出しています…');
      const blob = await this.exporter.exportProjectToWav(project, {
        onProgress: (r) => this._setProgress(r, 'CD用WAVを書き出しています…')
      });
      downloadBlob(blob, `${sanitizeFileName(project.name)}_CD用.wav`);
      this.showToast('CD用WAVを書き出しました。', 'success');
    } catch (err) {
      console.error(err);
      this.showToast('書き出しに失敗しました。もう一度お試しください。', 'error');
    } finally {
      this.progressWrap.hidden = true;
    }
  }

  async _exportTracksIndividually() {
    const project = this.getProject();
    if (project.setlistItems.length === 0) {
      this.showToast('セットリストに曲がありません。', 'warn');
      return;
    }
    try {
      this._setProgress(0.05, '曲ごとに書き出しています…');
      const files = await this.exporter.exportAllTracksSeparately(project, {
        onProgress: (r) => this._setProgress(r, '曲ごとに書き出しています…')
      });
      for (const f of files) downloadBlob(f.blob, f.filename);
      this.showToast(`${files.length}曲を書き出しました。`, 'success');
    } catch (err) {
      console.error(err);
      this.showToast('書き出しに失敗しました。もう一度お試しください。', 'error');
    } finally {
      this.progressWrap.hidden = true;
    }
  }

  async _exportTracksZip() {
    const project = this.getProject();
    if (project.setlistItems.length === 0) {
      this.showToast('セットリストに曲がありません。', 'warn');
      return;
    }
    try {
      this._setProgress(0.05, 'ZIPを作成しています…');
      const files = await this.exporter.exportAllTracksSeparately(project, {
        onProgress: (r) => this._setProgress(r * 0.8, 'ZIPを作成しています…')
      });
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const f of files) zip.file(f.filename, f.blob);
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        this._setProgress(0.8 + (meta.percent / 100) * 0.2, 'ZIPを作成しています…');
      });
      downloadBlob(zipBlob, `${sanitizeFileName(project.name)}_曲別.zip`);
      this.showToast('ZIPファイルを書き出しました。', 'success');
    } catch (err) {
      console.error(err);
      this.showToast('ZIPの作成に失敗しました。', 'error');
    } finally {
      this.progressWrap.hidden = true;
    }
  }
}
