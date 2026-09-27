import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { jsPDF } from 'jspdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SUPABASE_URL = 'https://tffvwxskvjuxoekwgdef.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmZnZ3eHNrdmp1eG9la3dnZGVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1Mzg4NDgsImV4cCI6MjEwNjExNDg0OH0.P-0qdPFja84MQsA-MlrbYSHXSKR-odXP92JSg6HLcvg';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.querySelector('#app');

const state = {
  mode: new URLSearchParams(location.search).get('sign') ? 'sign' : 'prepare',
  requestId: new URLSearchParams(location.search).get('sign'),
  title: 'İmza Daveti',
  pdfFile: null,
  pdfPath: '',
  pages: [],
  pageIndex: 0,
  fields: [],
  selectedId: null,
  selectMode: false,
  inviteLink: '',
  request: null,
  answers: {},
  finalPdf: null,
};

const css = `
*{box-sizing:border-box}
body{margin:0;background:#f2f5fa;color:#172033;font-family:Arial,system-ui,sans-serif}
button,input{font:inherit}
button{border:0;border-radius:8px;padding:11px 13px;background:#174bd6;color:white;font-weight:700;cursor:pointer}
button:disabled{opacity:.45;cursor:not-allowed}
input{width:100%;border:1px solid #cad4e3;border-radius:8px;padding:10px;background:white}
.top{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px;background:#fff;border-bottom:1px solid #dde4ef}
.top h1{margin:0;font-size:22px}.top p{margin:4px 0 0;color:#68758b;font-size:14px}
.fileBtn{background:#172033;color:#fff;border-radius:8px;padding:11px 13px;font-weight:700;cursor:pointer;white-space:nowrap}
.fileBtn input{display:none}
.bar{display:grid;grid-template-columns:1fr auto auto auto;gap:10px;padding:12px 16px;background:#f9fbff;border-bottom:1px solid #dde4ef;align-items:end}
label span{display:block;font-size:12px;font-weight:700;color:#68758b;margin-bottom:5px}
.status{min-height:30px;padding:7px 16px;font-weight:700;color:#206b3a}.status.err{color:#b42318}
.empty{display:grid;place-items:center;min-height:55vh;text-align:center;padding:20px}
.empty div{background:#fff;border:1px solid #dde4ef;border-radius:8px;padding:24px;max-width:560px}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:18px;padding:0 16px 20px}
.nav{display:flex;justify-content:center;align-items:center;gap:10px;margin:4px 0 12px}
.nav button{background:#fff;color:#172033;border:1px solid #cad4e3}
.page{position:relative;width:min(100%,920px);margin:0 auto;background:#fff;box-shadow:0 12px 36px #0002;overflow:hidden;border-radius:4px;touch-action:none;user-select:none}
.page.selecting{outline:3px solid #174bd6;cursor:crosshair}
.page>img{display:block;width:100%;height:100%;pointer-events:none}
.box{position:absolute;border:2px dashed #174bd6;background:#ffffffcc;color:#174bd6;border-radius:4px;min-width:44px;min-height:28px;overflow:hidden;cursor:pointer;padding:0}
.prepare .box{cursor:move}
.box.sel{border-style:solid;box-shadow:0 0 0 3px #174bd633}
.box span{position:absolute;left:4px;top:2px;right:4px;font-size:10px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2}
.box em{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);font-style:normal;font-size:12px;text-align:center}
.box img{position:absolute;left:8%;top:18%;width:84%;height:72%;object-fit:contain}
.dot{position:absolute;right:0;bottom:0;width:18px;height:18px;background:#174bd6;border-radius:8px 0 0 0;cursor:nwse-resize}
.panel{background:#fff;border:1px solid #dde4ef;border-radius:8px;padding:14px;margin-bottom:12px}
.panel h2{font-size:17px;margin:0 0 12px}.muted{color:#68758b;font-size:14px;line-height:1.4;margin:8px 0 0}
canvas{width:100%;height:150px;background:#fff;border:1px dashed #aeb9ca;border-radius:6px;touch-action:none}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
#sendWhatsApp,#shareBack{background:#0d8f4f}#savePdf{background:#172033}
.linkBox{word-break:break-all;background:#f2f5fa;border:1px solid #dde4ef;border-radius:8px;padding:10px;font-size:13px}
@media(max-width:860px){.bar{grid-template-columns:1fr 1fr}.layout{grid-template-columns:1fr;padding:0 10px 16px}.top{padding:12px}}
`;
document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

function esc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function id() {
  return crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
function status(msg, err = false) {
  const el = document.querySelector('#status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('err', err);
}
function currentPageFields() {
  return state.fields.filter(f => f.page === state.pageIndex);
}
function selectedField() {
  return state.fields.find(f => f.id === state.selectedId) || null;
}
function fieldAnswer(fieldId) {
  return state.answers[fieldId] || '';
}
function point(e, pageEl) {
  const r = pageEl.getBoundingClientRect();
  const p = e.touches?.[0] || e;
  return {
    x: ((p.clientX - r.left) / r.width) * 100,
    y: ((p.clientY - r.top) / r.height) * 100,
  };
}
function boxFrom(a, b) {
  const x1 = clamp(Math.min(a.x, b.x), 0, 100);
  const y1 = clamp(Math.min(a.y, b.y), 0, 100);
  const x2 = clamp(Math.max(a.x, b.x), 0, 100);
  const y2 = clamp(Math.max(a.y, b.y), 0, 100);
  return { x: x1, y: y1, w: clamp(x2 - x1, 0, 100 - x1), h: clamp(y2 - y1, 0, 100 - y1) };
}
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderPdf(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ w: canvas.width, h: canvas.height, img: canvas.toDataURL('image/jpeg', 0.9) });
  }
  return pages;
}

function render() {
  if (state.mode === 'sign') renderSign();
  else renderPrepare();
}

function topHtml(title, sub) {
  return `
    <div class="top">
      <div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
      ${state.mode === 'prepare' ? `
        <label class="fileBtn">PDF Yükle<input id="pdfInput" type="file" accept="application/pdf"></label>
      ` : ''}
    </div>
    <div id="status" class="status"></div>
  `;
}

function renderPrepare() {
  app.className = 'prepare';
  app.innerHTML = `
    ${topHtml('PDF İmza Daveti', 'PDF yükle, imza alanlarını seç, müşteriye WhatsApp linki gönder.')}
    <div class="bar">
      <label><span>Belge adı</span><input id="titleInput" value="${esc(state.title)}"></label>
      <button id="selectArea" ${!state.pages.length ? 'disabled' : ''}>İmza Alanı Seç</button>
      <button id="deleteArea" ${!state.selectedId ? 'disabled' : ''}>Alanı Sil</button>
      <button id="createInvite" ${!state.pdfFile || !state.fields.length ? 'disabled' : ''}>Link Oluştur</button>
    </div>
    ${state.pages.length ? prepareViewerHtml() : `
      <main class="empty"><div><h2>Başlamak için PDF yükleyin</h2><p>Sonra PDF üzerinde imza alanlarını sürükleyerek seçin.</p></div></main>
    `}
  `;
  bindPrepare();
}

function prepareViewerHtml() {
  return viewerHtml(`
    <section class="panel">
      <h2>Alan Bilgisi</h2>
      ${selectedField() ? `
        <label><span>İmza alanı adı</span><input id="fieldLabel" value="${esc(selectedField().label)}" placeholder="Alıcı imzası"></label>
        <p class="muted">Bu adı müşteri ekranda görecek.</p>
      ` : `<p class="muted">PDF üzerinde imza alanı seçin veya mevcut alana dokunun.</p>`}
    </section>
    <section class="panel">
      <h2>Gönderim</h2>
      ${state.inviteLink ? `
        <div class="linkBox">${esc(state.inviteLink)}</div>
        <div class="actions">
          <button id="copyLink">Linki Kopyala</button>
          <button id="sendWhatsApp">WhatsApp'tan Gönder</button>
        </div>
      ` : `
        <p class="muted">Alanları tanımladıktan sonra “Link Oluştur” düğmesine basın.</p>
      `}
    </section>
  `);
}

function renderSign() {
  app.className = 'sign';
  app.innerHTML = `
    ${topHtml('PDF İmza', 'Size gönderilen imza alanlarına imzanızı atın ve WhatsApp ile geri gönderin.')}
    ${state.pages.length ? signViewerHtml() : `
      <main class="empty"><div><h2>Belge yükleniyor</h2><p>Lütfen bekleyin.</p></div></main>
    `}
  `;
  bindSign();
}

function signViewerHtml() {
  const signedCount = state.fields.filter(f => fieldAnswer(f.id)).length;
  return viewerHtml(`
    <section class="panel">
      <h2>İmza At</h2>
      ${selectedField() ? `
        <p><strong>${esc(selectedField().label)}</strong></p>
        <canvas id="pad" width="560" height="190"></canvas>
        <div class="actions">
          <button id="clearPad">Temizle</button>
          <button id="savePad">Bu İmzayı Kaydet</button>
        </div>
        <p class="muted">Parmağınızla veya fareyle imza atın.</p>
      ` : `
        <p class="muted">PDF üzerindeki imza kutusuna dokunun.</p>
      `}
    </section>
    <section class="panel">
      <h2>Son İşlem</h2>
      <p class="muted">${signedCount} / ${state.fields.length} imza tamamlandı.</p>
      <button id="makePdf" ${signedCount === state.fields.length ? '' : 'disabled'}>İmzalı PDF Oluştur</button>
      <div class="actions">
        <button id="savePdf" ${state.finalPdf ? '' : 'disabled'}>Kaydet</button>
        <button id="shareBack" ${state.finalPdf ? '' : 'disabled'}>WhatsApp'tan Gönder</button>
      </div>
    </section>
  `);
}

function viewerHtml(sideHtml) {
  const p = state.pages[state.pageIndex];
  const boxes = currentPageFields().map(f => {
    const answer = fieldAnswer(f.id);
    return `
      <button class="box ${f.id === state.selectedId ? 'sel' : ''}" data-id="${f.id}"
        style="left:${f.x}%;top:${f.y}%;width:${f.w}%;height:${f.h}%">
        <span>${esc(f.label || 'İmza')}</span>
        ${answer ? `<img src="${answer}">` : `<em>${state.mode === 'sign' ? 'İmzala' : 'İmza alanı'}</em>`}
        ${state.mode === 'prepare' ? `<i class="dot" data-resize="${f.id}"></i>` : ''}
      </button>
    `;
  }).join('');

  return `
    <main class="layout">
      <section>
        <div class="nav">
          <button id="prev" ${state.pageIndex === 0 ? 'disabled' : ''}>Önceki</button>
          <strong>Sayfa ${state.pageIndex + 1} / ${state.pages.length}</strong>
          <button id="next" ${state.pageIndex === state.pages.length - 1 ? 'disabled' : ''}>Sonraki</button>
        </div>
        <div id="pdfPage" class="page ${state.selectMode ? 'selecting' : ''}" style="aspect-ratio:${p.w}/${p.h}">
          <img src="${p.img}">
          ${boxes}
        </div>
      </section>
      <aside>${sideHtml}</aside>
    </main>
  `;
}

function bindCommon() {
  document.querySelector('#prev')?.addEventListener('click', () => {
    state.pageIndex--;
    state.selectedId = null;
    render();
  });
  document.querySelector('#next')?.addEventListener('click', () => {
    state.pageIndex++;
    state.selectedId = null;
    render();
  });
  document.querySelectorAll('.box').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      state.selectedId = el.dataset.id;
      state.selectMode = false;
      render();
    });
  });
}

function bindPrepare() {
  bindCommon();

  document.querySelector('#pdfInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      status('PDF yükleniyor...');
      state.pdfFile = file;
      state.title = file.name.replace(/\.pdf$/i, '');
      state.pages = await renderPdf(await file.arrayBuffer());
      state.fields = [];
      state.selectedId = null;
      state.pageIndex = 0;
      state.inviteLink = '';
      render();
      status('PDF hazır. İmza alanlarını seçin.');
    } catch (err) {
      console.error(err);
      status('PDF yüklenemedi.', true);
    }
  });

  document.querySelector('#titleInput')?.addEventListener('input', e => {
    state.title = e.target.value;
  });

  document.querySelector('#selectArea')?.addEventListener('click', () => {
    state.selectMode = !state.selectMode;
    render();
    status(state.selectMode ? 'PDF üzerinde imza alanını sürükleyerek seçin.' : '');
  });

  document.querySelector('#deleteArea')?.addEventListener('click', () => {
    state.fields = state.fields.filter(f => f.id !== state.selectedId);
    state.selectedId = null;
    state.inviteLink = '';
    render();
  });

  document.querySelector('#fieldLabel')?.addEventListener('input', e => {
    const f = selectedField();
    if (!f) return;
    f.label = e.target.value;
    state.inviteLink = '';
    const label = document.querySelector(`.box[data-id="${f.id}"] span`);
    if (label) label.textContent = f.label || 'İmza';
  });

  document.querySelector('#createInvite')?.addEventListener('click', createInvite);
  document.querySelector('#copyLink')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.inviteLink);
    status('Link kopyalandı.');
  });
  document.querySelector('#sendWhatsApp')?.addEventListener('click', () => {
    const text = encodeURIComponent(`Merhaba, imza için bu bağlantıyı açabilir misiniz?\n${state.inviteLink}`);
    location.href = `https://wa.me/?text=${text}`;
  });

  const page = document.querySelector('#pdfPage');
  if (page) bindPreparePage(page);

  document.querySelectorAll('.box').forEach(el => {
    el.addEventListener('pointerdown', e => dragBox(e, el.dataset.id));
  });
  document.querySelectorAll('.dot').forEach(el => {
    el.addEventListener('pointerdown', e => resizeBox(e, el.dataset.resize));
  });
}

function bindPreparePage(pageEl) {
  let start = null;
  let draft = null;

  pageEl.addEventListener('pointerdown', e => {
    if (!state.selectMode) return;
    if (e.target.closest('.box')) return;
    start = point(e, pageEl);
    draft = document.createElement('div');
    draft.className = 'box sel';
    draft.innerHTML = '<em>Yeni alan</em>';
    pageEl.appendChild(draft);
    e.preventDefault();
  });

  pageEl.addEventListener('pointermove', e => {
    if (!start || !draft) return;
    const b = boxFrom(start, point(e, pageEl));
    draft.style.left = b.x + '%';
    draft.style.top = b.y + '%';
    draft.style.width = b.w + '%';
    draft.style.height = b.h + '%';
  });

  window.addEventListener('pointerup', e => {
    if (!start) return;
    const b = boxFrom(start, point(e, pageEl));
    start = null;
    draft?.remove();
    draft = null;

    if (b.w < 4 || b.h < 2.5) {
      status('Alan çok küçük. Biraz daha geniş seçin.', true);
      return;
    }

    const newId = id();
    state.fields.push({
      id: newId,
      page: state.pageIndex,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      label: `İmza ${state.fields.length + 1}`,
    });
    state.selectedId = newId;
    state.selectMode = false;
    state.inviteLink = '';
    render();
  });
}

function dragBox(e, fieldId) {
  if (e.target.classList.contains('dot')) return;
  const page = document.querySelector('#pdfPage');
  const f = state.fields.find(x => x.id === fieldId);
  if (!page || !f) return;

  state.selectedId = fieldId;
  const start = point(e, page);
  const ox = f.x;
  const oy = f.y;

  function move(ev) {
    const p = point(ev, page);
    f.x = clamp(ox + p.x - start.x, 0, 100 - f.w);
    f.y = clamp(oy + p.y - start.y, 0, 100 - f.h);
    const el = document.querySelector(`.box[data-id="${f.id}"]`);
    if (el) {
      el.style.left = f.x + '%';
      el.style.top = f.y + '%';
    }
    state.inviteLink = '';
  }

  function up() {
    window.removeEventListener('pointermove', move);
    render();
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
  e.preventDefault();
  e.stopPropagation();
}

function resizeBox(e, fieldId) {
  const page = document.querySelector('#pdfPage');
  const f = state.fields.find(x => x.id === fieldId);
  if (!page || !f) return;

  const start = point(e, page);
  const ow = f.w;
  const oh = f.h;

  function move(ev) {
    const p = point(ev, page);
    f.w = clamp(ow + p.x - start.x, 4, 100 - f.x);
    f.h = clamp(oh + p.y - start.y, 2.5, 100 - f.y);
    const el = document.querySelector(`.box[data-id="${f.id}"]`);
    if (el) {
      el.style.width = f.w + '%';
      el.style.height = f.h + '%';
    }
    state.inviteLink = '';
  }

  function up() {
    window.removeEventListener('pointermove', move);
    render();
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
  e.preventDefault();
  e.stopPropagation();
}

async function createInvite() {
  try {
    status('PDF yükleniyor ve link oluşturuluyor...');

    const pdfPath = `originals/${id()}.pdf`;
    const up = await supabase.storage.from('signing-pdfs').upload(pdfPath, state.pdfFile, {
      contentType: 'application/pdf',
    });
    if (up.error) throw up.error;

    const ins = await supabase
      .from('signing_requests')
      .insert({
        title: state.title || 'İmza Daveti',
        pdf_path: pdfPath,
        fields: state.fields,
        status: 'pending',
      })
      .select('id')
      .single();

    if (ins.error) throw ins.error;

    const base = `${location.origin}${location.pathname}`;
    state.inviteLink = `${base}?sign=${ins.data.id}`;
    render();
    status('İmza linki hazır. WhatsApp ile gönderebilirsiniz.');
  } catch (err) {
    console.error(err);
    status(`Link oluşturulamadı: ${err.message || err}`, true);
  }
}

function bindSign() {
  bindCommon();

  document.querySelector('#clearPad')?.addEventListener('click', () => {
    const f = selectedField();
    if (!f) return;
    state.answers[f.id] = '';
    render();
  });

  document.querySelector('#savePad')?.addEventListener('click', () => {
    const f = selectedField();
    const canvas = document.querySelector('#pad');
    if (!f || !canvas) return;
    state.answers[f.id] = canvas.toDataURL('image/png');
    state.finalPdf = null;
    render();
    status('İmza kaydedildi.');
  });

  document.querySelector('#makePdf')?.addEventListener('click', makeSignedPdf);
  document.querySelector('#savePdf')?.addEventListener('click', savePdf);
  document.querySelector('#shareBack')?.addEventListener('click', shareBack);

  const f = selectedField();
  if (f) bindPad(f);
}

function bindPad(field) {
  const canvas = document.querySelector('#pad');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#174bd6';
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const existing = state.answers[field.id];
  if (existing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = existing;
  }

  let drawing = false;
  let last = null;

  function p(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return {
      x: (t.clientX - r.left) * (canvas.width / r.width),
      y: (t.clientY - r.top) * (canvas.height / r.height),
    };
  }
  function start(e) {
    drawing = true;
    last = p(e);
    e.preventDefault();
  }
  function move(e) {
    if (!drawing) return;
    const now = p(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(now.x, now.y);
    ctx.stroke();
    last = now;
    e.preventDefault();
  }
  function end() {
    if (!drawing) return;
    drawing = false;
    state.answers[field.id] = canvas.toDataURL('image/png');
    state.finalPdf = null;
  }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

async function loadSignRequest() {
  try {
    status('Belge yükleniyor...');

    const res = await supabase
      .from('signing_requests')
      .select('*')
      .eq('id', state.requestId)
      .single();

    if (res.error) throw res.error;

    state.request = res.data;
    state.title = res.data.title || 'İmza Daveti';
    state.fields = res.data.fields || [];

    const publicUrl = supabase.storage.from('signing-pdfs').getPublicUrl(res.data.pdf_path).data.publicUrl;
    const pdfRes = await fetch(publicUrl);
    const buffer = await pdfRes.arrayBuffer();

    state.pages = await renderPdf(buffer);
    state.pageIndex = 0;
    render();
    status('Belge hazır. İmza kutularına dokunup imza atın.');
  } catch (err) {
    console.error(err);
    status(`Belge yüklenemedi: ${err.message || err}`, true);
  }
}

async function renderSignedPage(page, pageNo) {
  const base = await loadImg(page.img);
  const canvas = document.createElement('canvas');
  canvas.width = page.w;
  canvas.height = page.h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

  const list = state.fields.filter(f => f.page === pageNo && state.answers[f.id]);

  for (const f of list) {
    const x = f.x / 100 * canvas.width;
    const y = f.y / 100 * canvas.height;
    const w = f.w / 100 * canvas.width;
    const h = f.h / 100 * canvas.height;

    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = '#174bd6';
    ctx.font = `600 ${Math.max(10, Math.min(18, h * 0.16))}px Arial`;
    ctx.textBaseline = 'top';
    ctx.fillText(f.label || 'İmza', x + 6, y + 4, w - 12);

    const img = await loadImg(state.answers[f.id]);
    const top = Math.min(24, h * 0.25);
    const aw = Math.max(1, w - 10);
    const ah = Math.max(1, h - top - 8);
    const scale = Math.min(aw / img.width, ah / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + top + (ah - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}

async function makeSignedPdf() {
  try {
    status('İmzalı PDF oluşturuluyor...');

    let doc = null;
    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i];
      const img = await renderSignedPage(p, i);

      if (!doc) doc = new jsPDF({ unit: 'px', format: [p.w, p.h], compress: true });
      else doc.addPage([p.w, p.h]);

      doc.addImage(img, 'JPEG', 0, 0, p.w, p.h);
    }

    const blob = doc.output('blob');
    const name = `${(state.title || 'imzali-belge').replace(/[\\/:*?"<>|]/g, '')}-imzali.pdf`;

    const path = `signed/${state.requestId}-${Date.now()}.pdf`;
    const up = await supabase.storage.from('signing-pdfs').upload(path, blob, {
      contentType: 'application/pdf',
    });
    if (up.error) throw up.error;

    await supabase
      .from('signing_requests')
      .update({ status: 'signed', signed_pdf_path: path })
      .eq('id', state.requestId);

    state.finalPdf = {
      blob,
      name,
      file: new File([blob], name, { type: 'application/pdf' }),
    };

    render();
    status('İmzalı PDF hazır. WhatsApp ile geri gönderebilirsiniz.');
  } catch (err) {
    console.error(err);
    status(`PDF oluşturulamadı: ${err.message || err}`, true);
  }
}

function savePdf() {
  if (!state.finalPdf) return;
  const url = URL.createObjectURL(state.finalPdf.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.finalPdf.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function shareBack() {
  if (!state.finalPdf) return;

  if (navigator.canShare?.({ files: [state.finalPdf.file] }) && navigator.share) {
    await navigator.share({
      title: 'İmzalı PDF',
      text: 'İmzalı PDF ektedir.',
      files: [state.finalPdf.file],
    });
    return;
  }

  savePdf();
  status('Bu cihaz doğrudan paylaşımı desteklemedi. PDF indirildi; WhatsApp içinde belge olarak seçilebilir.');
}

render();

if (state.mode === 'sign') {
  loadSignRequest();
}