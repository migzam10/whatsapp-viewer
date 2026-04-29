// ── PALETTE for participants ──
const PALETTE = [
  '#e91e63','#9c27b0','#3f51b5','#2196f3',
  '#009688','#ff5722','#795548','#607d8b',
  '#f44336','#673ab7','#03a9f4','#4caf50',
  '#ff9800','#00bcd4','#8bc34a','#ff4081',
];

// ── STATE ──
let myName = null; // first person detected = "yo" (out)
let colorMap = {};
let paletteIdx = 0;

function getColor(name) {
  if (!colorMap[name]) {
    colorMap[name] = PALETTE[paletteIdx % PALETTE.length];
    paletteIdx++;
  }
  return colorMap[name];
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0,2).toUpperCase();
}

// ── PARSE ──
// Format A: [DD/MM/YY, HH:MM:SS a.m.] Sender: message   (newer iOS/Android)
const LINE_RE_A = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[ap]\.?m\.?)\]\s+(.*)/i;
// Format B: DD/MM/YYYY, HH:MM - Sender: message          (older / web export)
const LINE_RE_B = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?)\s+-\s+(.*)/i;
// Sender extractor — allows colons inside name (e.g. "+57 300: ..." won't break)
const MSG_RE    = /^([^:]+?):\s([\s\S]*)$/;

function parseLine(line) {
  let m = LINE_RE_A.exec(line.trim());
  if (!m) m = LINE_RE_B.exec(line.trim());
  return m || null;
}

function parseChat(raw) {
  // Strip BOM and invisible chars some exports add
  const cleaned = raw.replace(/^\uFEFF/, '').replace(/\u200e/g, '');
  const lines = cleaned.split('\n');
  const entries = [];
  let cur = null;

  for (const line of lines) {
    const m = parseLine(line);
    if (m) {
      if (cur) entries.push(cur);
      const dateStr = m[1], timeStr = m[2].trim(), rest = m[3];
      const msgMatch = MSG_RE.exec(rest);
      if (msgMatch) {
        cur = { date: dateStr, time: timeStr, sender: msgMatch[1].trim(), text: msgMatch[2], system: false };
      } else {
        cur = { date: dateStr, time: timeStr, sender: null, text: rest, system: true };
      }
    } else if (cur) {
      cur.text += '\n' + line;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

// ── FORMAT DATE ──
const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function formatDate(d) {
  const parts = d.split('/');
  const day = parseInt(parts[0]), month = parseInt(parts[1]), year = parts[2];
  return `${day} ${MONTHS[month-1]} ${year.length === 2 ? '20'+year : year}`;
}


// ── RENDER ──
function renderChat(entries) {
  const body = document.getElementById('chat-body');
  body.innerHTML = '';

  const senders = [...new Set(entries.filter(e=>!e.system && e.sender).map(e=>e.sender))];
  const isGroup = senders.length > 2;

  // Build color map in order of first appearance
  paletteIdx = 0; colorMap = {};
  senders.forEach(s => getColor(s));

  // In a 2-person chat: first sender = "out" (the exporter)
  const mySender = (!isGroup && senders.length >= 1) ? senders[0] : null;

  // Stats
  const totalMsgs = entries.filter(e=>!e.system).length;
  const mediaCount = entries.filter(e=>!e.system && e.text.includes('<Multimedia omitido>')).length;

  // Participant bar
  const pBar = document.getElementById('participants-bar');
  if (senders.length > 1) {
    pBar.style.display = 'flex';
    pBar.innerHTML = senders.map(s => `
      <div class="chip">
        <div class="chip-dot" style="background:${getColor(s)}"></div>
        ${escHtml(s)}
      </div>`).join('');
  } else {
    pBar.style.display = 'none';
  }

  // Header
  document.getElementById('header-avatar').textContent = isGroup ? '👥' : '👤';
  document.getElementById('header-name').textContent =
    isGroup ? `Grupo (${senders.length} participantes)` : senders.join(' & ');
  document.getElementById('header-sub').textContent =
    `${totalMsgs} mensajes · ${entries[0]?.date || ''}`;
  document.getElementById('btn-new').style.display = 'flex';

  // Render messages
  let lastDate = null;
  let lastSender = null;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    // Date separator
    if (e.date !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.innerHTML = `<span>${formatDate(e.date)}</span>`;
      body.appendChild(sep);
      lastDate = e.date;
      lastSender = null;
    }

    // System message
    if (e.system) {
      const el = document.createElement('div');
      el.className = 'sys-msg';
      el.innerHTML = `<span>${escHtml(e.text)}</span>`;
      body.appendChild(el);
      lastSender = null;
      continue;
    }

    // Determine direction
    const isOut = (!isGroup && e.sender === mySender);
    const color = getColor(e.sender);
    const showSenderName = isGroup && e.sender !== lastSender;
    const showAvatar = isGroup;

    // Next message same sender?
    const nextSameSender = i+1 < entries.length && entries[i+1].sender === e.sender && !entries[i+1].system;

    // Row
    const row = document.createElement('div');
    row.className = `msg-row ${isOut ? 'out' : 'in'}`;

    // Avatar (group only)
    let avatarHtml = '';
    if (showAvatar) {
      if (!nextSameSender) {
        avatarHtml = `<div class="msg-avatar" style="background:${color}">${escHtml(initials(e.sender))}</div>`;
      } else {
        avatarHtml = `<div class="msg-avatar hidden"></div>`;
      }
    }

    // Text
    const isMedia = e.text.trim() === '<Multimedia omitido>';
    let contentHtml;
    if (isMedia) {
      const icons = ['🖼️','📷','🎬','📹','🎵','📄','📎'];
      const ico = icons[Math.floor(Math.random()*3)];
      contentHtml = `<div class="media-omit"><span>${ico}</span> Multimedia omitido</div>`;
    } else {
      contentHtml = `<span class="msg-text">${escHtml(e.text)}</span>`;
    }

    const senderLabel = (isGroup && showSenderName && !isOut)
      ? `<span class="sender-name" style="color:${color}">${escHtml(e.sender)}</span>`
      : '';

    row.innerHTML = `
      ${isOut ? '' : avatarHtml}
      <div class="bubble">
        ${senderLabel}
        ${contentHtml}
        <div class="msg-meta">
          <span class="msg-time">${escHtml(e.time)}</span>
          ${isOut ? '<span style="color:#53bdeb;font-size:13px">✓✓</span>' : ''}
        </div>
      </div>
      ${isOut ? avatarHtml : ''}
    `;

    body.appendChild(row);
    lastSender = e.sender;
  }

  // Stats bar
  const msgPerSender = {};
  entries.filter(e=>!e.system && e.sender).forEach(e => {
    msgPerSender[e.sender] = (msgPerSender[e.sender]||0)+1;
  });
  const topSenders = Object.entries(msgPerSender).sort((a,b)=>b[1]-a[1]).slice(0,3);
  document.getElementById('stats-bar').innerHTML = `
    <span>💬 <b>${totalMsgs}</b> mensajes</span>
    <span>🖼 <b>${mediaCount}</b> multimedia</span>
    <span>👥 <b>${senders.length}</b> participantes</span>
    ${topSenders.map(([s,n])=>`<span style="color:${getColor(s)}">● ${escHtml(s)}: <b>${n}</b></span>`).join('')}
  `;

  // Scroll to bottom
  setTimeout(() => { body.scrollTop = body.scrollHeight; }, 80);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── FILE HANDLING ──
function processFile(file) {
  if (!file || !file.name.endsWith('.txt')) {
    alert('Por favor selecciona un archivo .txt exportado de WhatsApp');
    return;
  }

  document.getElementById('drop-screen').style.display = 'none';
  document.getElementById('loading').classList.add('visible');
  document.getElementById('chat-screen').classList.remove('visible');

  const reader = new FileReader();
  reader.onload = (e) => {
    setTimeout(() => {
      const entries = parseChat(e.target.result);
      document.getElementById('loading').classList.remove('visible');
      document.getElementById('chat-screen').classList.add('visible');
      renderChat(entries);
    }, 400);
  };
  reader.readAsText(file, 'UTF-8');
}

// ── EVENTS ──
document.getElementById('btn-open').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', (e) => {
  processFile(e.target.files[0]);
  e.target.value = '';
});

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  processFile(e.dataTransfer.files[0]);
});

document.getElementById('btn-new').addEventListener('click', () => {
  document.getElementById('chat-screen').classList.remove('visible');
  document.getElementById('drop-screen').style.display = 'flex';
  document.getElementById('btn-new').style.display = 'none';
  document.getElementById('header-name').textContent = 'WhatsApp Viewer';
  document.getElementById('header-sub').textContent = 'Carga un archivo .txt exportado de WhatsApp';
  document.getElementById('header-avatar').textContent = '💬';
  document.getElementById('participants-bar').style.display = 'none';
  document.getElementById('file-input').click();
});

// Scroll to bottom button
const chatBody = document.getElementById('chat-body');
const scrollBtn = document.getElementById('scroll-btn');
chatBody.addEventListener('scroll', () => {
  const distFromBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
  scrollBtn.classList.toggle('visible', distFromBottom > 200);
});
scrollBtn.addEventListener('click', () => {
  chatBody.scrollTop = chatBody.scrollHeight;
});