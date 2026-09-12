import { formatTimeShort } from '../utils/formatTime.js';

/**
 * 左側パネルのセットリスト表示。
 * ドラッグ＆ドロップで曲順を入れ替えられる。
 */
export class SetlistPanel {
  constructor({ listEl, selection, onReorder, onSelect, onRename }) {
    this.listEl = listEl;
    this.selection = selection;
    this.onReorder = onReorder;
    this.onSelect = onSelect;
    this.onRename = onRename;
    this.dragFromId = null;
    this.selection.addEventListener('change', () => this._highlightSelection());
  }

  render(project) {
    this.listEl.innerHTML = '';
    const items = project.setlistItems;

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'setlist-empty';
      li.textContent = 'BGMを追加すると、ここに曲が並びます';
      this.listEl.appendChild(li);
      return;
    }

    for (const { index, clip } of items) {
      const li = document.createElement('li');
      li.className = 'setlist-item';
      li.draggable = true;
      li.dataset.clipId = clip.id;
      if (this.selection.isSelected(clip.id)) li.classList.add('selected');

      const numberEl = document.createElement('span');
      numberEl.className = 'setlist-number';
      numberEl.textContent = String(index).padStart(2, '0');

      const infoEl = document.createElement('div');
      infoEl.className = 'setlist-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'setlist-name';
      nameEl.textContent = clip.setlistLabel || clip.name;
      const metaEl = document.createElement('div');
      metaEl.className = 'setlist-meta';
      metaEl.textContent = `長さ ${formatTimeShort(clip.duration)} ／ 開始 ${formatTimeShort(clip.start)}`;
      infoEl.appendChild(nameEl);
      infoEl.appendChild(metaEl);

      li.appendChild(numberEl);
      li.appendChild(infoEl);

      li.addEventListener('click', () => this.onSelect(clip.id));
      li.addEventListener('dblclick', () => {
        const name = window.prompt('曲名を変更', clip.setlistLabel || clip.name);
        if (name != null && name.trim()) this.onRename(clip.id, name.trim());
      });

      li.addEventListener('dragstart', (e) => {
        this.dragFromId = clip.id;
        e.dataTransfer.effectAllowed = 'move';
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        li.classList.add('drag-over');
      });
      li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        if (!this.dragFromId || this.dragFromId === clip.id) return;
        const order = items.map((it) => it.clip.id);
        const fromIdx = order.indexOf(this.dragFromId);
        const toIdx = order.indexOf(clip.id);
        order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
        this.onReorder(order);
      });

      this.listEl.appendChild(li);
    }
  }

  _highlightSelection() {
    for (const li of this.listEl.querySelectorAll('.setlist-item')) {
      li.classList.toggle('selected', li.dataset.clipId === this.selection.selectedClipId);
    }
  }
}
