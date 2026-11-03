import { $, $$, downloadBlob, showToast } from '@/ui.js';

const formatMetaRows = (m) => {
  const rows = [
    ['Modo', m.mode],
    ['Lente', m.lens],
    ['Zoom', `${m.zoom}x`],
    ['ISO', m.iso],
    ['Velocidad', m.shutter],
    ['Apertura', `f/${m.aperture}`],
    ['Perfil de color', m.profile],
    ['Balance de blancos', `${m.kelvin} K`],
    ['Resolución', m.width && m.height ? `${m.width} × ${m.height}` : null],
    ['Sensor', m.sensor],
    ['Fecha', m.createdAt ? new Date(m.createdAt).toLocaleString('es') : null],
  ];
  if (m.videoProfile) rows.push(['Calidad de video', m.videoProfile], ['Duración', `${m.durationSeconds} s`]);
  if (m.location) rows.push(['Ubicación', `${m.location.lat}, ${m.location.lon}`]);
  return rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
};

const fillDefinitionList = (dl, rows) => {
  dl.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      return [dt, dd];
    })
  );
};

export function createGalleryModal({ root, loadHistory }) {
  let items = [];
  let selectedId = null;
  const mediaEl = $('#galleryMedia', root);
  const stripEl = $('#galleryStrip', root);
  const metaEl = $('#galleryMeta', root);
  const historyEl = $('#galleryHistory', root);

  const selectedItem = () => items.find((item) => item.id === selectedId) ?? null;

  function renderMedia(item) {
    if (!item) {
      const p = document.createElement('p');
      p.className = 'gallery-empty';
      p.textContent = 'Aún no hay capturas en esta sesión';
      mediaEl.replaceChildren(p);
      return;
    }
    const el = item.kind === 'video' ? document.createElement('video') : document.createElement('img');
    el.src = item.url;
    if (item.kind === 'video') {
      el.controls = true;
      el.playsInline = true;
    } else {
      el.alt = item.name;
    }
    mediaEl.replaceChildren(el);
  }

  function renderStrip() {
    stripEl.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `thumb-item${item.id === selectedId ? ' active' : ''}`;
        if (item.kind === 'video') {
          button.textContent = 'VIDEO';
        } else {
          const img = document.createElement('img');
          img.src = item.url;
          img.alt = '';
          button.append(img);
        }
        button.addEventListener('click', () => select(item.id));
        return button;
      })
    );
  }

  function select(id) {
    selectedId = id;
    const item = selectedItem();
    renderMedia(item);
    renderStrip();
    fillDefinitionList(metaEl, item ? formatMetaRows(item.meta) : []);
  }

  async function renderHistory() {
    historyEl.replaceChildren(itemText('Cargando historial...'));
    try {
      const rows = await loadHistory();
      if (rows.length === 0) {
        historyEl.replaceChildren(itemText('Todavía no hay capturas registradas'));
        return;
      }
      historyEl.replaceChildren(
        ...rows.map((row) => {
          const m = row.metadata ?? {};
          const date = new Date(row.created_at).toLocaleString('es');
          return itemText(`${date} · ${m.mode ?? 'Captura'}${m.iso ? ` · ISO ${m.iso}` : ''}`);
        })
      );
    } catch (error) {
      console.error(error);
      historyEl.replaceChildren(itemText('No se pudo cargar el historial'));
    }
  }

  function itemText(text) {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }

  async function share() {
    const item = selectedItem();
    if (!item) return;
    const file = new File([item.blob], item.name, { type: item.blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: item.name });
      } catch (error) {
        if (error.name !== 'AbortError') showToast('No se pudo compartir');
      }
      return;
    }
    downloadBlob(item.blob, item.name);
    showToast('Compartir no está disponible: el archivo se descargó');
  }

  function close() {
    root.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
  });
  $('#galleryDownload', root).addEventListener('click', () => {
    const item = selectedItem();
    if (item) downloadBlob(item.blob, item.name);
  });
  $('#galleryShare', root).addEventListener('click', share);

  return {
    open(nextItems) {
      items = nextItems;
      select(items[0]?.id ?? null);
      root.classList.remove('hidden');
      document.body.classList.add('modal-open');
      renderHistory();
    },
    close,
    updateItems(nextItems) {
      items = nextItems;
      if (!items.some((item) => item.id === selectedId)) selectedId = items[0]?.id ?? null;
      select(selectedId);
    },
  };
}

export function createSheet(root) {
  function open() {
    root.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function close() {
    root.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
  });

  return { open, close };
}

const NUMERIC_SETTINGS = new Set(['quality', 'sharpness']);

export function createSettingsModal({ root, onSave }) {
  const cameraSelect = $('#sCamera', root);
  const saveBtn = $('#settingsSave', root);

  function open({ settings, cameras, cameraId }) {
    cameraSelect.replaceChildren(
      new Option('Automática (trasera)', ''),
      ...cameras.map((camera) => new Option(camera.label, camera.id))
    );
    cameraSelect.value = cameraId;
    for (const field of $$('[data-setting]', root)) {
      const name = field.dataset.setting;
      if (name === 'cameraId') continue;
      if (field.type === 'checkbox') field.checked = Boolean(settings[name]);
      else field.value = String(settings[name]);
    }
    root.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function collect() {
    const settings = {};
    for (const field of $$('[data-setting]', root)) {
      const name = field.dataset.setting;
      if (name === 'cameraId') continue;
      if (field.type === 'checkbox') settings[name] = field.checked;
      else if (NUMERIC_SETTINGS.has(name)) settings[name] = Number(field.value);
      else settings[name] = field.value;
    }
    return { settings, cameraId: cameraSelect.value };
  }

  function close() {
    root.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    const ok = await onSave(collect());
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar ajustes';
    if (ok) close();
  });

  return { open, close };
}
