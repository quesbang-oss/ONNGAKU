import { formatTimeShort } from '../utils/formatTime.js';
import { DEFAULT_COUNTDOWN_SECONDS } from '../utils/constants.js';

/**
 * 本番モード（発表会・文化祭当日に使う、誤操作しにくいシンプルな再生画面）。
 */
export class PerformanceMode {
  constructor({ engine, getProject, onExit }) {
    this.engine = engine;
    this.getProject = getProject;
    this.onExit = onExit;
    this.overlay = document.getElementById('performance-mode');
    this.playBtn = document.getElementById('perform-play');
    this.pauseBtn = document.getElementById('perform-pause');
    this.stopBtn = document.getElementById('perform-stop');
    this.countdownBtn = document.getElementById('perform-countdown-btn');
    this.countdownEl = document.getElementById('perform-countdown');
    this.currentEl = document.getElementById('perform-current');
    this.totalEl = document.getElementById('perform-total');
    this.nextEl = document.getElementById('perform-next');
    this.secondsInput = document.getElementById('perform-countdown-seconds');

    document.getElementById('btn-perform-exit').addEventListener('click', () => this.hide());
    this.playBtn.addEventListener('click', () => this._play());
    this.pauseBtn.addEventListener('click', () => this._pause());
    this.stopBtn.addEventListener('click', () => this._stop());
    this.countdownBtn.addEventListener('click', () => this._startCountdown());

    this.engine.onTimeUpdate((t) => this._updateTimeDisplay(t));
  }

  show() {
    this.overlay.hidden = false;
    this.secondsInput.value = this.getProject().countdownSeconds || DEFAULT_COUNTDOWN_SECONDS;
    this._refresh();
  }

  hide() {
    this.overlay.hidden = true;
    this.onExit();
  }

  _refresh() {
    const project = this.getProject();
    this.totalEl.textContent = formatTimeShort(project.duration);
    this._updatePlayPauseUI(this.engine.isPlaying);
    this._updateNextTrack();
  }

  _play() {
    this.engine.play(this.getProject(), this.engine.pausedAt);
    this._updatePlayPauseUI(true);
  }

  _pause() {
    this.engine.pause();
    this._updatePlayPauseUI(false);
  }

  _stop() {
    this.engine.stop();
    this._updatePlayPauseUI(false);
    this._updateTimeDisplay(0);
  }

  _updatePlayPauseUI(isPlaying) {
    this.playBtn.style.display = isPlaying ? 'none' : '';
    this.pauseBtn.style.display = isPlaying ? '' : 'none';
  }

  _updateTimeDisplay(t) {
    if (this.overlay.hidden) return;
    this.currentEl.textContent = formatTimeShort(t);
    this._updateNextTrack(t);
  }

  _updateNextTrack(currentTime = this.engine.getCurrentTime()) {
    const project = this.getProject();
    const items = project.setlistItems;
    const next = items.find(({ clip }) => clip.start > currentTime + 0.1);
    this.nextEl.textContent = next ? `次: ${next.clip.setlistLabel || next.clip.name}` : '';
  }

  async _startCountdown() {
    const seconds = Math.max(1, Math.min(10, Number(this.secondsInput.value) || DEFAULT_COUNTDOWN_SECONDS));
    this.countdownEl.hidden = false;
    for (let i = seconds; i >= 1; i--) {
      this.countdownEl.textContent = String(i);
      await wait(1000);
    }
    this.countdownEl.textContent = 'START';
    await wait(500);
    this.countdownEl.hidden = true;
    this._play();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
