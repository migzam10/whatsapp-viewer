// ============================================================
//  WhatsApp Chat Viewer
//  Soporta los 3 formatos de exportación de WhatsApp:
//   1. Antiguo:   15/1/2025, 12:22 - Sender: msg            (24h)
//   2. Celular:   25/03/26, 2:22 p. m. - Sender: msg        (am/pm)
//   3. Web/iOS:   [25/03/26, 2:22:09 p. m.] Sender: msg     (corchetes)
//  + multimedia real desde .zip o carpeta (imágenes, audio, video)
// ============================================================

// ── PALETA de colores por participante ──
const PALETTE = [
  '#e91e63','#9c27b0','#3f51b5','#2196f3',
  '#009688','#ff5722','#795548','#607d8b',
  '#f44336','#673ab7','#03a9f4','#4caf50',
  '#ff9800','#00bcd4','#8bc34a','#ff4081',
];

// ── ESTADO ──
let colorMap = {};
let paletteIdx = 0;
let currentEntries = [];   // mensajes parseados del chat actual
let mediaMap = new Map();  // basename(lowercase) -> blob URL
let myName = null;         // participante marcado como "yo" (mensajes a la derecha)
let isGroup = false;
let senders = [];

function getColor(name) {
  if (!colorMap[name]) {
    colorMap[name] = PALETTE[paletteIdx % PALETTE.length];
    paletteIdx++;
  }
  return colorMap[name];
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
}

// ── LIMPIEZA de caracteres invisibles ──
// WhatsApp inserta marcas de dirección bidireccional y espacios "raros"
// (esto es lo que rompía el parseo de los formatos nuevos: "p. m.")
const BIDI_MARKS = /[\u200e\u200f\u202a\u202b\u202c\u2066\u2067\u2068\u2069\u061c]/g;
const WEIRD_SPACE = /[\u00a0\u202f\u2007\u2009\u200a\u2002\u2003]/g;

function cleanText(s) {
  return s.replace(BIDI_MARKS, '').replace(WEIRD_SPACE, ' ');
}

// ── PARSE ──
// Formato corchetes (web/iOS): [fecha, hora] resto
const RE_BRACKET = /^\[\s*(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)\s*\]\s*(.*)$/i;
// Formato guion (antiguo + celular nuevo): fecha, hora - resto
const RE_DASH    = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)\s+-\s+(.*)$/i;
// Separa "Nombre: mensaje" (nombre sin ':' y de longitud razonable)
const RE_SENDER  = /^([^:\n]{1,80}?):\s([\s\S]*)$/;

// Frases que, aunque tengan "Nombre:", son mensajes de sistema (no de un usuario)
const SYSTEM_PHRASES = /(los mensajes y las llamadas est[áa]n cifrados|cre[óo] (el|este) grupo|te a[ñn]adi[óo]|a[ñn]adi[óo] a|cambi[óo] (el|su|tu|de) |saliste del grupo|sali[óo] del grupo|elimin[óo] a |es un contacto|cambi[óo] su n[úu]mero|se uni[óo]|mensajes temporales|cambiaste el|ahora eres administrador|este mensaje fue eliminado|se elimin[óo] este mensaje|c[óo]digo de seguridad)/i;

function parseDateTime(dateStr, timeStr) {
  // dateStr: D/M/YY o D/M/YYYY (orden día/mes, típico LatAm/ES)
  const [d, mo, y] = dateStr.split('/').map(n => parseInt(n, 10));
  const year = y < 100 ? 2000 + y : y;
  let hh = 0, mm = 0, ss = 0;
  const tm = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i);
  if (tm) {
    hh = parseInt(tm[1], 10) % 12;
    if (/p/i.test(tm[4])) hh += 12;
    mm = parseInt(tm[2], 10);
    ss = tm[3] ? parseInt(tm[3], 10) : 0;
  } else {
    const t24 = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (t24) { hh = parseInt(t24[1], 10); mm = parseInt(t24[2], 10); ss = t24[3] ? parseInt(t24[3], 10) : 0; }
  }
  return new Date(year, (mo || 1) - 1, d || 1, hh, mm, ss);
}

function parseLine(line) {
  let m = RE_BRACKET.exec(line);
  if (!m) m = RE_DASH.exec(line);
  return m; // [full, date, time, rest] | null
}

// Detecta y extrae multimedia / marcadores dentro del texto
const RE_ATTACH_NAMED = /<\s*(?:adjunto|attached|archivo adjunto)\s*:\s*([^>]+?)\s*>/i;
const RE_ATTACH_ANDROID = /([^\s<>"]+\.[a-z0-9]{2,4})\s*\((?:archivo adjunto|file attached)\)/i;
const RE_OMITTED = /^<?\s*(?:multimedia omitid[oa]|imagen omitida|audio omitido|v[íi]deo omitido|video omitido|sticker omitido|gif omitido|documento omitido|.*\bomitid[oa]\b|.*\bomitted\b)\s*>?$/i;
const RE_EDITED  = /<\s*(?:se edit[óo] este mensaje\.?|this message was edited\.?)\s*>/i;
const RE_DELETED = /^<?\s*(?:se elimin[óo] este mensaje\.?|eliminaste este mensaje\.?|this message was deleted\.?|you deleted this message\.?)\s*>?$/i;

function mediaKind(name) {
  const n = (name || '').toLowerCase();
  if (/\.webp$/.test(n) || /-sticker-/.test(n)) return 'sticker';
  if (/\.(jpe?g|png|gif|heic|heif|bmp|tiff?)$/.test(n) || /-photo-|-img-|\bimg-/.test(n)) return 'image';
  if (/\.(opus|mp3|m4a|ogg|wav|aac|amr|3ga)$/.test(n) || /-audio-|-ptt-/.test(n)) return 'audio';
  if (/\.(mp4|3gp|mov|mkv|avi|webm|m4v)$/.test(n) || /-video-/.test(n)) return 'video';
  return 'file';
}

function kindFromHint(text) {
  const t = text.toLowerCase();
  if (/sticker/.test(t)) return 'sticker';
  if (/imagen|image|foto|photo/.test(t)) return 'image';
  if (/audio|voz|voice|ptt/.test(t)) return 'audio';
  if (/v[íi]deo|video/.test(t)) return 'video';
  if (/gif/.test(t)) return 'image';
  return 'file';
}

function detectMedia(text) {
  let m = text.match(RE_ATTACH_NAMED) || text.match(RE_ATTACH_ANDROID);
  if (m) {
    const filename = m[1].trim();
    return {
      filename,
      kind: mediaKind(filename),
      caption: text.replace(m[0], '').trim(),
      omitted: false,
    };
  }
  if (RE_OMITTED.test(text.trim())) {
    return { filename: null, kind: kindFromHint(text), caption: '', omitted: true };
  }
  return null;
}

function parseChat(raw) {
  const lines = cleanText(raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')).split('\n');
  const entries = [];
  let cur = null;

  const push = () => {
    if (!cur) return;
    // Procesa el texto acumulado: editado / borrado / multimedia
    let txt = cur.text;
    if (RE_EDITED.test(txt)) { cur.edited = true; txt = txt.replace(RE_EDITED, '').trim(); }
    if (RE_DELETED.test(txt.trim())) { cur.deleted = true; }
    cur.media = detectMedia(txt);
    if (cur.media) txt = cur.media.caption || '';
    cur.text = txt;
    // ¿mensaje de sistema con remitente? (web export atribuye los avisos)
    if (cur.sender && !cur.media && SYSTEM_PHRASES.test(cur.text)) cur.system = true;
    entries.push(cur);
  };

  for (const line of lines) {
    const m = parseLine(line);
    if (m) {
      push();
      const dateStr = m[1], timeStr = m[2].trim(), rest = m[3];
      const sm = RE_SENDER.exec(rest);
      cur = sm
        ? { date: dateStr, time: timeStr, datetime: parseDateTime(dateStr, timeStr),
            sender: normalizeName(sm[1]), rawSender: sm[1].trim(), text: sm[2], system: false }
        : { date: dateStr, time: timeStr, datetime: parseDateTime(dateStr, timeStr),
            sender: null, text: rest, system: true };
      cur.edited = false; cur.deleted = false; cur.media = null;
    } else if (cur) {
      cur.text += '\n' + line;
    }
  }
  push();
  return entries;
}

// "~ Erika Ramos" -> "Erika Ramos" (el ~ marca no-contactos)
function normalizeName(name) {
  return name.trim().replace(/^~\s*/, '').trim();
}

// ── FORMATO de fecha legible ──
const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function formatDate(dt) {
  if (!(dt instanceof Date) || isNaN(dt)) return '';
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// ── ESCAPE + linkificación ──
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ── RENDER de un adjunto multimedia ──
const MEDIA_ICON = { image:'🖼️', sticker:'🩹', audio:'🎵', video:'🎬', file:'📄' };

function renderMedia(media) {
  const url = media.filename ? mediaMap.get(media.filename.toLowerCase()) : null;
  if (media.omitted || !url) {
    const ico = MEDIA_ICON[media.kind] || '📎';
    const label = media.omitted
      ? 'Multimedia omitido'
      : escHtml(media.filename || 'Archivo adjunto');
    return `<div class="media-omit"><span>${ico}</span> ${label}</div>`;
  }
  switch (media.kind) {
    case 'image':
    case 'sticker':
      return `<a href="${url}" target="_blank" rel="noopener" class="media-link">
                <img class="media-img${media.kind === 'sticker' ? ' sticker' : ''}" src="${url}" loading="lazy" alt="imagen">
              </a>`;
    case 'audio':
      return `<audio class="media-audio" controls preload="none" src="${url}"></audio>`;
    case 'video':
      return `<video class="media-video" controls preload="metadata" src="${url}"></video>`;
    default:
      return `<a class="media-file" href="${url}" download="${escHtml(media.filename)}">
                <span>📄</span> ${escHtml(media.filename)}</a>`;
  }
}

// ── RENDER del chat ──
function renderChat(entries) {
  senders = [...new Set(entries.filter(e => !e.system && e.sender).map(e => e.sender))];
  isGroup = senders.length > 2;

  paletteIdx = 0; colorMap = {};
  senders.forEach(s => getColor(s));

  // "yo" guardado por chat, o por defecto el primer remitente en chat 1-a-1
  const chatKey = 'wv-me:' + senders.slice().sort().join('|');
  const stored = localStorage.getItem(chatKey);
  if (stored && senders.includes(stored)) myName = stored;
  else if (myName && senders.includes(myName)) { /* mantener */ }
  else myName = (!isGroup && senders.length >= 1) ? senders[senders.length - 1] : null;

  renderParticipants(chatKey);

  // Header
  document.getElementById('header-avatar').textContent = isGroup ? '👥' : '👤';
  document.getElementById('header-name').textContent =
    isGroup ? `Grupo · ${senders.length} participantes` : senders.join(' & ') || 'Chat';
  const totalMsgs = entries.filter(e => !e.system).length;
  document.getElementById('header-sub').textContent =
    `${totalMsgs} mensajes · desde ${formatDate(entries[0]?.datetime)}`;
  document.getElementById('btn-new').style.display = 'flex';
  document.getElementById('btn-search').style.display = 'flex';

  // Calcula los descriptores de fila UNA vez (O(n), sin tocar el DOM).
  // El DOM se crea por lotes para no congelar el navegador en chats enormes.
  rows = buildRows(entries);
  renderInitial();

  renderStats(entries);
  resetSearch();
}

// ── RENDERIZADO POR LOTES (virtualización ligera) ──
// rows: descriptores de fila ya calculados. Solo creamos DOM del tramo visible
// y cargamos los mensajes más antiguos al hacer scroll hacia arriba.
let rows = [];
let renderedFrom = 0;      // rows[renderedFrom..] están en el DOM
const BATCH = 400;

function buildRows(entries) {
  const out = [];
  let lastDate = null, lastSender = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const dayLabel = formatDate(e.datetime);
    if (dayLabel !== lastDate) { out.push({ kind: 'sep', label: dayLabel }); lastDate = dayLabel; lastSender = null; }
    if (e.system) { out.push({ kind: 'sys', text: e.text }); lastSender = null; continue; }
    const isOut = e.sender === myName;
    const nextSame = i + 1 < entries.length && !entries[i + 1].system && entries[i + 1].sender === e.sender;
    out.push({
      kind: 'msg', e, isOut, color: getColor(e.sender),
      showSenderName: isGroup && e.sender !== lastSender && !isOut,
      showAvatar: isGroup, nextSame,
    });
    lastSender = e.sender;
  }
  return out;
}

function rowToHtml(row) {
  if (row.kind === 'sep') return `<div class="date-sep"><span>${row.label}</span></div>`;
  if (row.kind === 'sys') return `<div class="sys-msg"><span>${escHtml(row.text)}</span></div>`;
  const { e, isOut, color, showSenderName, showAvatar, nextSame } = row;
  const avatarHtml = !showAvatar ? '' : (nextSame
    ? `<div class="msg-avatar hidden"></div>`
    : `<div class="msg-avatar" style="background:${color}">${escHtml(initials(e.sender))}</div>`);

  let contentHtml = '';
  if (e.media) contentHtml += renderMedia(e.media);
  if (e.deleted) {
    contentHtml += `<span class="msg-text deleted">🚫 Se eliminó este mensaje</span>`;
  } else if (e.text) {
    contentHtml += `<span class="msg-text">${linkify(escHtml(e.text))}${e.edited ? ' <span class="edited">(editado)</span>' : ''}</span>`;
  } else if (e.edited) {
    contentHtml += `<span class="edited">(editado)</span>`;
  }
  const senderLabel = showSenderName
    ? `<span class="sender-name" style="color:${color}">${escHtml(e.sender)}</span>` : '';

  return `<div class="msg-row ${isOut ? 'out' : 'in'}">
    ${isOut ? '' : avatarHtml}
    <div class="bubble">${senderLabel}${contentHtml}
      <div class="msg-meta"><span class="msg-time">${escHtml(e.time)}</span>${isOut ? '<span class="tick">✓✓</span>' : ''}</div>
    </div>
    ${isOut ? avatarHtml : ''}</div>`;
}

function renderInitial() {
  const body = document.getElementById('chat-body');
  renderedFrom = Math.max(0, rows.length - BATCH);
  body.innerHTML = rows.slice(renderedFrom).map(rowToHtml).join('');
  setTimeout(() => { body.scrollTop = body.scrollHeight; }, 60);
}

// Antepone un lote (o todo) preservando la posición de scroll
function prependRows(from) {
  if (from >= renderedFrom) return;
  const body = document.getElementById('chat-body');
  const prevH = body.scrollHeight, prevTop = body.scrollTop;
  body.insertAdjacentHTML('afterbegin', rows.slice(from, renderedFrom).map(rowToHtml).join(''));
  body.scrollTop = prevTop + (body.scrollHeight - prevH);
  renderedFrom = from;
}

function renderOlder() { prependRows(Math.max(0, renderedFrom - BATCH)); }
function ensureAllRendered() { if (renderedFrom > 0) prependRows(0); }

// Barra de participantes (clic = "este soy yo")
function renderParticipants(chatKey) {
  const pBar = document.getElementById('participants-bar');
  if (senders.length < 2) { pBar.style.display = 'none'; return; }
  pBar.style.display = 'flex';
  pBar.innerHTML =
    `<span class="participants-hint">Toca tu nombre para marcar tus mensajes →</span>` +
    senders.map(s => `
      <button class="chip${s === myName ? ' me' : ''}" data-sender="${escHtml(s)}">
        <span class="chip-dot" style="background:${getColor(s)}"></span>
        ${escHtml(s)}${s === myName ? ' <b>· yo</b>' : ''}
      </button>`).join('');

  pBar.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const s = chip.dataset.sender;
      myName = (myName === s) ? null : s;
      if (myName) localStorage.setItem(chatKey, myName);
      else localStorage.removeItem(chatKey);
      renderChat(currentEntries);
    });
  });
}

// Barra de estadísticas
function renderStats(entries) {
  const real = entries.filter(e => !e.system);
  const mediaCount = real.filter(e => e.media).length;
  const perSender = {};
  real.forEach(e => { if (e.sender) perSender[e.sender] = (perSender[e.sender] || 0) + 1; });
  const top = Object.entries(perSender).sort((a, b) => b[1] - a[1]).slice(0, 4);
  document.getElementById('stats-bar').innerHTML = `
    <span>💬 <b>${real.length}</b> mensajes</span>
    <span>📎 <b>${mediaCount}</b> multimedia</span>
    <span>👥 <b>${senders.length}</b> participantes</span>
    ${top.map(([s, n]) => `<span style="color:${getColor(s)}">● ${escHtml(s)}: <b>${n}</b></span>`).join('')}`;
}

// ── BÚSQUEDA ──
let searchHits = [], searchIdx = -1;

function resetSearch() {
  searchHits = []; searchIdx = -1;
  document.getElementById('search-count').textContent = '';
}

function doSearch(q) {
  // la búsqueda recorre todo el chat: asegura que esté todo en el DOM
  if (q.trim()) ensureAllRendered();
  // limpia resaltados previos
  document.querySelectorAll('.msg-text mark').forEach(m => {
    const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
  });
  searchHits = []; searchIdx = -1;
  const term = q.trim().toLowerCase();
  const countEl = document.getElementById('search-count');
  if (!term) { countEl.textContent = ''; return; }

  document.querySelectorAll('#chat-body .msg-text').forEach(el => {
    if (!el.textContent.toLowerCase().includes(term)) return;
    highlightIn(el, term);
    el.querySelectorAll('mark').forEach(mk => searchHits.push(mk));
  });

  if (searchHits.length) { searchIdx = 0; focusHit(); }
  countEl.textContent = searchHits.length ? `1/${searchHits.length}` : 'sin resultados';
}

function highlightIn(el, term) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const txt = node.textContent;
    const idx = txt.toLowerCase().indexOf(term);
    if (idx === -1) return;
    const frag = document.createDocumentFragment();
    let last = 0, pos = idx;
    while (pos !== -1) {
      frag.appendChild(document.createTextNode(txt.slice(last, pos)));
      const mark = document.createElement('mark');
      mark.textContent = txt.slice(pos, pos + term.length);
      frag.appendChild(mark);
      last = pos + term.length;
      pos = txt.toLowerCase().indexOf(term, last);
    }
    frag.appendChild(document.createTextNode(txt.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
}

function focusHit() {
  searchHits.forEach(m => m.classList.remove('active'));
  const hit = searchHits[searchIdx];
  if (!hit) return;
  hit.classList.add('active');
  hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
  document.getElementById('search-count').textContent = `${searchIdx + 1}/${searchHits.length}`;
}

function stepSearch(dir) {
  if (!searchHits.length) return;
  searchIdx = (searchIdx + dir + searchHits.length) % searchHits.length;
  focusHit();
}

// ── CARGA de archivos (.txt, .zip o carpeta) ──
function showLoading() {
  document.getElementById('drop-screen').style.display = 'none';
  document.getElementById('loading').classList.add('visible');
  document.getElementById('chat-screen').classList.remove('visible');
}
function showChat() {
  document.getElementById('loading').classList.remove('visible');
  document.getElementById('chat-screen').classList.add('visible');
}
function fail(msg) {
  document.getElementById('loading').classList.remove('visible');
  document.getElementById('drop-screen').style.display = 'flex';
  alert(msg);
}

function clearMedia() {
  mediaMap.forEach(url => URL.revokeObjectURL(url));
  mediaMap = new Map();
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  clearMedia();
  showLoading();

  try {
    const zip = files.find(f => /\.zip$/i.test(f.name));
    if (zip) {
      await loadZip(zip);
    } else {
      const txt = files.find(f => /\.txt$/i.test(f.name));
      if (!txt) throw new Error('No encontré ningún .txt exportado de WhatsApp.');
      // construye el mapa de multimedia con el resto de archivos (carpeta)
      files.forEach(f => {
        if (f === txt || /\.txt$/i.test(f.name)) return;
        const base = (f.name.split('/').pop() || f.name).toLowerCase();
        mediaMap.set(base, URL.createObjectURL(f));
      });
      const raw = await readText(txt);
      finishLoad(raw);
    }
  } catch (err) {
    fail('No pude leer el chat: ' + err.message);
  }
}

function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('error de lectura'));
    r.readAsText(file, 'UTF-8');
  });
}

async function loadZip(file) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip no se cargó (revisa tu conexión).');
  const zip = await JSZip.loadAsync(file);
  const all = Object.values(zip.files).filter(f => !f.dir);
  // elige el _chat.txt (o el primer .txt)
  let chatFile = all.find(f => /_chat\.txt$/i.test(f.name)) || all.find(f => /\.txt$/i.test(f.name));
  if (!chatFile) throw new Error('El .zip no contiene un .txt de chat.');
  const raw = await chatFile.async('string');
  // mapa de multimedia
  for (const f of all) {
    if (/\.txt$/i.test(f.name)) continue;
    const base = (f.name.split('/').pop() || f.name).toLowerCase();
    const blob = await f.async('blob');
    mediaMap.set(base, URL.createObjectURL(blob));
  }
  finishLoad(raw);
}

function finishLoad(raw) {
  currentEntries = parseChat(raw);
  if (!currentEntries.length) { fail('No reconocí el formato de este chat 😕'); return; }
  myName = null;
  showChat();
  renderChat(currentEntries);
}

// ── EVENTOS ──
document.getElementById('btn-open').addEventListener('click', () =>
  document.getElementById('file-input').click());

document.getElementById('btn-folder')?.addEventListener('click', () =>
  document.getElementById('folder-input').click());

document.getElementById('file-input').addEventListener('change', e => {
  handleFiles(e.target.files); e.target.value = '';
});
document.getElementById('folder-input')?.addEventListener('change', e => {
  handleFiles(e.target.files); e.target.value = '';
});

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragging');
  handleFiles(e.dataTransfer.files);
});

document.getElementById('btn-new').addEventListener('click', () => {
  clearMedia();
  document.getElementById('chat-screen').classList.remove('visible');
  document.getElementById('drop-screen').style.display = 'flex';
  document.getElementById('btn-new').style.display = 'none';
  document.getElementById('btn-search').style.display = 'none';
  document.getElementById('search-bar').classList.remove('open');
  document.getElementById('header-name').textContent = 'WhatsApp Viewer';
  document.getElementById('header-sub').textContent = 'Carga un archivo .txt o .zip exportado de WhatsApp';
  document.getElementById('header-avatar').textContent = '💬';
  document.getElementById('participants-bar').style.display = 'none';
});

// Búsqueda UI
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
document.getElementById('btn-search').addEventListener('click', () => {
  searchBar.classList.toggle('open');
  if (searchBar.classList.contains('open')) searchInput.focus();
  else { searchInput.value = ''; doSearch(''); }
});
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(searchInput.value), 180);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') document.getElementById('btn-search').click();
});
document.getElementById('search-prev').addEventListener('click', () => stepSearch(-1));
document.getElementById('search-next').addEventListener('click', () => stepSearch(1));

// Tema claro / oscuro
const THEME_KEY = 'wv-theme';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('btn-theme').textContent = t === 'light' ? '🌙' : '☀️';
}
document.getElementById('btn-theme').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next); applyTheme(next);
});
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

// Botón de scroll al final
const chatBody = document.getElementById('chat-body');
const scrollBtn = document.getElementById('scroll-btn');
chatBody.addEventListener('scroll', () => {
  const dist = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
  scrollBtn.classList.toggle('visible', dist > 200);
  // Carga mensajes más antiguos al acercarse al tope
  if (chatBody.scrollTop < 300 && renderedFrom > 0) renderOlder();
});
scrollBtn.addEventListener('click', () => { chatBody.scrollTop = chatBody.scrollHeight; });
