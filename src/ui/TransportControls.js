import { formatTimeTenths } from '../utils/formatTime.js';

/** 下部トランスポートバー（再生・停止・音量など）の配線。 */
export class TransportControls {
  constructor({ onPlay, onPause, onStop, onHome, onEnd, onMasterVolumeChange, onBgmVolumeChange, onSfxVolumeChange, onMuteToggle }) {
    this.playBtn = byId('btn-play');
    this.pauseBtn = byId('btn-pause');
    this.timeCurrentEl = byId('time-current');
    this.timeTotalEl = byId('time-total');
    this.nextTrackLabelEl = byId('next-track-label');
    this.muteBtn = byId('btn-mute');
    this.muted = false;

    this.playBtn.addEventListener('click', onPlay);
    this.pauseBtn.addEventListener('click', onPause);
    byId('btn-stop').addEventListener('click', onStop);
    byId('btn-home').addEventListener('click', onHome);
    byId('btn-end').addEventListener('click', onEnd);
    byId('master-volume').addEventListener('input', (e) => onMasterVolumeChange(Number(e.target.value)));
    byId('bgm-volume').addEventListener('input', (e) => onBgmVolumeChange(Number(e.target.value)));
    byId('sfx-volume').addEventListener('input', (e) => onSfxVolumeChange(Number(e.target.value)));
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      this.muteBtn.textContent = this.muted ? '🔇' : '🔊';
      onMuteToggle(this.muted);
    });
  }

  setPlayingState(isPlaying) {
    this.playBtn.style.display = isPlaying ? 'none' : '';
    this.pauseBtn.style.display = isPlaying ? '' : 'none';
  }

  updateTime(current, total) {
    this.timeCurrentEl.textContent = formatTimeTenths(current);
    this.timeTotalEl.textContent = formatTimeTenths(total);
  }

  updateNextTrackLabel(text) {
    this.nextTrackLabelEl.textContent = text ? `次の曲: ${text}` : '';
  }

  syncVolumeSliders(project) {
    byId('master-volume').value = project.masterVolumeDb;
    byId('bgm-volume').value = project.bgmTrack.volumeDb;
    byId('sfx-volume').value = project.sfxTrack.volumeDb;
  }
}

function byId(id) {
  return document.getElementById(id);
}
