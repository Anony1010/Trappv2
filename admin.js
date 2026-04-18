/**
 * ============================================================
 *  TrackDown — /66 ADMIN MODULE
 *  Mövcud koda toxunmadan əlavə edilir.
 *  Daxildir:
 *    • /66 Telegram admin paneli (botlar, fayllar, linklər, +bot)
 *    • Avtomatik fayl qəbulu (photo / video / index.html)
 *    • Fullscreen viewer  /v/:id  (autoplay + səsli + controls OFF)
 *    • Link deaktivasiyası (real-time)
 *    • Multi-bot dəstəyi (yeni bot tokenlə əlavə)
 *  Persistans: data/state.json
 * ============================================================
 */

const fs   = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const DATA_DIR  = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const UPLOAD_DIR = path.join(__dirname, 'view', 'uploads');

if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── State (in-memory + disk) ─────────────────────────────
let state = {
  files: {},   // { id: { type:'photo'|'video'|'html', filename, originalName, ownerId, createdAt } }
  links: {},   // { id: { fileId, active:true, createdAt, ownerId } }
  bots:  {}    // { token: { addedAt, addedBy, label } }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch (e) { console.error('state load err:', e.message); }
}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e) { console.error('state save err:', e.message); }
}
loadState();

// ── Util ─────────────────────────────────────────────────
function rndId(n=8){
  const c='abcdefghijklmnopqrstuvwxyz0123456789';
  let s=''; for(let i=0;i<n;i++) s+=c[Math.floor(Math.random()*c.length)]; return s;
}

// ───────────────────────────────────────────────────────
//  EXPORT: (app, mainBot, getHost) => attaches everything
// ───────────────────────────────────────────────────────
module.exports = function attachAdmin(app, mainBot, getHost) {

  const allBots = [mainBot]; // mainBot + dynamically added
  const adminUsers = new Set(); // chat IDs that opened /66

  // Mövcud əlavə botları yenidən başlat
  for (const token of Object.keys(state.bots)) {
    try {
      const b = new TelegramBot(token, { polling: true });
      bindBot(b);
      allBots.push(b);
      console.log(`🤖 Əlavə bot yükləndi: ${token.slice(0,10)}…`);
    } catch (e) { console.error('bot reload err:', e.message); }
  }

  // ───────────── ROUTES ─────────────

  // Fullscreen viewer
  app.get('/v/:id', (req, res) => {
    const link = state.links[req.params.id];
    if (!link || !link.active) {
      return res.status(410).send(deactivatedPage());
    }
    const file = state.files[link.fileId];
    if (!file) return res.status(404).send('Fayl tapılmadı');

    const url = `/uploads/${file.filename}`;
    if (file.type === 'photo') {
      return res.send(fullscreenPhoto(url));
    }
    if (file.type === 'video') {
      return res.send(fullscreenVideo(url));
    }
    if (file.type === 'html') {
      // raw HTML — fullscreen iframe deyil, birbaşa göstər
      return res.sendFile(path.join(UPLOAD_DIR, file.filename));
    }
    res.status(400).send('Naməlum fayl növü');
  });

  // Yüklənmiş faylları statik ver
  app.use('/uploads', require('express').static(UPLOAD_DIR));

  // ───────────── TELEGRAM HANDLERS ─────────────

  bindBot(mainBot);

  function bindBot(bot) {

    // /66 — admin panel
    bot.onText(/^\/66$/, (msg) => {
      adminUsers.add(msg.chat.id);
      sendPanel(bot, msg.chat.id);
    });

    // Fayl qəbulu (photo / video / document)
    bot.on('photo', async (msg) => handleIncoming(bot, msg, 'photo'));
    bot.on('video', async (msg) => handleIncoming(bot, msg, 'video'));
    bot.on('document', async (msg) => handleIncoming(bot, msg, 'document'));

    // Callback queries (panel düymələri)
    bot.on('callback_query', async (cbq) => {
      const data = cbq.data || '';
      if (!data.startsWith('a:')) return; // başqa modul, toxunma

      const chatId = cbq.message.chat.id;
      bot.answerCallbackQuery(cbq.id).catch(()=>{});

      const [, action, arg] = data.split(':');

      if (action === 'panel')  return sendPanel(bot, chatId, cbq.message.message_id);
      if (action === 'bots')   return listBots(bot, chatId, cbq.message.message_id);
      if (action === 'files')  return listFiles(bot, chatId, cbq.message.message_id);
      if (action === 'links')  return listLinks(bot, chatId, cbq.message.message_id, getHost(null));
      if (action === 'addbot') return askNewBotToken(bot, chatId);
      if (action === 'close')  return bot.deleteMessage(chatId, cbq.message.message_id).catch(()=>{});

      if (action === 'delfile') {
        const f = state.files[arg];
        if (f) {
          try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)); } catch(_){}
          delete state.files[arg];
          // həmin fayla bağlı linkləri də sil
          for (const lid of Object.keys(state.links)) {
            if (state.links[lid].fileId === arg) delete state.links[lid];
          }
          saveState();
        }
        return listFiles(bot, chatId, cbq.message.message_id);
      }

      if (action === 'mklink') {
        if (!state.files[arg]) return;
        const id = rndId(8);
        state.links[id] = { fileId: arg, active: true, createdAt: Date.now(), ownerId: chatId };
        saveState();
        const host = getHost(null) || '<HOST>';
        await bot.sendMessage(chatId,
          `✅ Link yaradıldı:\n${host}/v/${id}\n\nDeaktiv etmək üçün /66 → Linklər`);
        return listFiles(bot, chatId, cbq.message.message_id);
      }

      if (action === 'togglelink') {
        if (state.links[arg]) {
          state.links[arg].active = !state.links[arg].active;
          saveState();
        }
        return listLinks(bot, chatId, cbq.message.message_id, getHost(null));
      }

      if (action === 'dellink') {
        delete state.links[arg];
        saveState();
        return listLinks(bot, chatId, cbq.message.message_id, getHost(null));
      }

      if (action === 'delbot') {
        const token = Buffer.from(arg, 'base64url').toString('utf8');
        delete state.bots[token];
        saveState();
        await bot.sendMessage(chatId, '🗑 Bot silindi (yenidən başlatma sonrası tam dayanacaq).');
        return listBots(bot, chatId, cbq.message.message_id);
      }
    });

    // Yeni bot tokeni qəbul et (force_reply cavabı)
    bot.on('message', async (msg) => {
      if (msg?.reply_to_message?.text === '🔑 Yeni bot tokenini göndər:') {
        const token = (msg.text || '').trim();
        if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
          return bot.sendMessage(msg.chat.id, '❌ Yanlış token formatı.');
        }
        if (state.bots[token]) {
          return bot.sendMessage(msg.chat.id, '⚠️ Bu bot artıq əlavə edilib.');
        }
        try {
          const nb = new TelegramBot(token, { polling: true });
          bindBot(nb);
          allBots.push(nb);
          state.bots[token] = { addedAt: Date.now(), addedBy: msg.chat.id };
          saveState();
          bot.sendMessage(msg.chat.id, '✅ Bot əlavə edildi və işə salındı.');
        } catch (e) {
          bot.sendMessage(msg.chat.id, '❌ Bot başlamadı: ' + e.message);
        }
      }
    });
  }

  // ─── FAYL QƏBULU ───
  async function handleIncoming(bot, msg, kind) {
    const chatId = msg.chat.id;
    try {
      let fileId, originalName, type;

      if (kind === 'photo') {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        originalName = `photo_${Date.now()}.jpg`;
        type = 'photo';
      } else if (kind === 'video') {
        fileId = msg.video.file_id;
        originalName = msg.video.file_name || `video_${Date.now()}.mp4`;
        type = 'video';
      } else if (kind === 'document') {
        const doc = msg.document;
        const name = (doc.file_name || '').toLowerCase();
        if (name.endsWith('.html') || name.endsWith('.htm')) {
          fileId = doc.file_id;
          originalName = doc.file_name;
          type = 'html';
        } else if (doc.mime_type?.startsWith('image/')) {
          fileId = doc.file_id; originalName = doc.file_name; type = 'photo';
        } else if (doc.mime_type?.startsWith('video/')) {
          fileId = doc.file_id; originalName = doc.file_name; type = 'video';
        } else {
          return; // bu modulu maraqlandırmır
        }
      }

      const id = rndId(10);
      const ext = path.extname(originalName) || (type==='photo'?'.jpg':type==='video'?'.mp4':'.html');
      const filename = `${id}${ext}`;
      const dest = path.join(UPLOAD_DIR, filename);

      const stream = bot.getFileStream(fileId);
      const out = fs.createWriteStream(dest);
      await new Promise((res, rej) => {
        stream.pipe(out);
        out.on('finish', res);
        out.on('error', rej);
        stream.on('error', rej);
      });

      state.files[id] = {
        type, filename, originalName,
        ownerId: chatId, createdAt: Date.now()
      };
      // Avtomatik link
      const linkId = rndId(8);
      state.links[linkId] = { fileId: id, active: true, createdAt: Date.now(), ownerId: chatId };
      saveState();

      const host = getHost(null) || '<HOST_URL>';
      bot.sendMessage(chatId,
        `✅ Fayl qəbul edildi (${type}).\n\n` +
        `🔗 Fullscreen link:\n${host}/v/${linkId}\n\n` +
        `İdarə üçün /66`,
        { reply_markup: { inline_keyboard: [[
          { text: '🛑 Deaktiv et', callback_data: `a:togglelink:${linkId}` },
          { text: '📋 Panel',     callback_data: 'a:panel' }
        ]]}}
      );
    } catch (e) {
      console.error('upload err:', e.message);
      bot.sendMessage(chatId, '❌ Fayl yüklənərkən xəta: ' + e.message);
    }
  }

  // ─── PANEL UI ───
  function sendPanel(bot, chatId, editId) {
    const text =
`╔══════════════════╗
   ⚙️  ADMIN PANEL  /66
╚══════════════════╝

📊 Statistika:
• Botlar : ${1 + Object.keys(state.bots).length}
• Fayllar: ${Object.keys(state.files).length}
• Linklər: ${Object.keys(state.links).length}  (aktiv: ${Object.values(state.links).filter(l=>l.active).length})

Əməliyyat seçin 👇`;
    const kb = { inline_keyboard: [
      [{ text: '🤖 Botlar', callback_data: 'a:bots' }, { text: '📁 Fayllar', callback_data: 'a:files' }],
      [{ text: '🔗 Linklər', callback_data: 'a:links' }, { text: '➕ Yeni Bot', callback_data: 'a:addbot' }],
      [{ text: '✖️ Bağla', callback_data: 'a:close' }]
    ]};
    if (editId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: editId, reply_markup: kb }).catch(()=>{
        bot.sendMessage(chatId, text, { reply_markup: kb });
      });
    } else {
      bot.sendMessage(chatId, text, { reply_markup: kb });
    }
  }

  function listBots(bot, chatId, editId) {
    const rows = [[{ text: '🤖 Əsas bot (config)', callback_data: 'a:panel' }]];
    for (const token of Object.keys(state.bots)) {
      const b64 = Buffer.from(token).toString('base64url');
      rows.push([
        { text: `🤖 ${token.slice(0,10)}…`, callback_data: 'a:panel' },
        { text: '🗑', callback_data: `a:delbot:${b64}` }
      ]);
    }
    rows.push([{ text: '➕ Yeni Bot', callback_data: 'a:addbot' }]);
    rows.push([{ text: '⬅️ Geri', callback_data: 'a:panel' }]);
    bot.editMessageText(`🤖 *Botlar* (${1+Object.keys(state.bots).length})`,
      { chat_id: chatId, message_id: editId, parse_mode:'Markdown', reply_markup:{inline_keyboard:rows}}
    ).catch(()=>bot.sendMessage(chatId,'🤖 Botlar', {reply_markup:{inline_keyboard:rows}}));
  }

  function listFiles(bot, chatId, editId) {
    const ids = Object.keys(state.files).slice(-20).reverse();
    if (!ids.length) {
      const kb = {inline_keyboard:[[{text:'⬅️ Geri',callback_data:'a:panel'}]]};
      return bot.editMessageText('📁 Hələ fayl yoxdur.\n\nMənə şəkil, video və ya .html göndərin.',
        {chat_id:chatId, message_id:editId, reply_markup:kb}).catch(()=>{});
    }
    const rows = ids.map(id => {
      const f = state.files[id];
      const icon = f.type==='photo'?'🖼':f.type==='video'?'🎬':'📄';
      return [
        { text: `${icon} ${f.originalName.slice(0,20)}`, callback_data: `a:mklink:${id}` },
        { text: '🗑', callback_data: `a:delfile:${id}` }
      ];
    });
    rows.push([{ text: '⬅️ Geri', callback_data: 'a:panel' }]);
    bot.editMessageText(
      `📁 *Fayllar* (${Object.keys(state.files).length})\n\nFayla toxunaraq yeni link yarat. 🗑 silir.`,
      { chat_id:chatId, message_id:editId, parse_mode:'Markdown', reply_markup:{inline_keyboard:rows}}
    ).catch(()=>{});
  }

  function listLinks(bot, chatId, editId, host) {
    const ids = Object.keys(state.links).slice(-20).reverse();
    if (!ids.length) {
      const kb = {inline_keyboard:[[{text:'⬅️ Geri',callback_data:'a:panel'}]]};
      return bot.editMessageText('🔗 Hələ link yoxdur.', {chat_id:chatId, message_id:editId, reply_markup:kb}).catch(()=>{});
    }
    const rows = ids.map(id => {
      const l = state.links[id];
      const icon = l.active ? '🟢' : '🔴';
      return [
        { text: `${icon} /v/${id}`, callback_data: `a:togglelink:${id}` },
        { text: l.active?'🛑':'✅', callback_data: `a:togglelink:${id}` },
        { text: '🗑', callback_data: `a:dellink:${id}` }
      ];
    });
    rows.push([{ text: '⬅️ Geri', callback_data: 'a:panel' }]);
    let txt = `🔗 *Linklər* (${ids.length})\n\nHost: ${host || '—'}\n🟢 aktiv · 🔴 deaktiv`;
    bot.editMessageText(txt,
      {chat_id:chatId, message_id:editId, parse_mode:'Markdown', reply_markup:{inline_keyboard:rows}}
    ).catch(()=>{});
  }

  function askNewBotToken(bot, chatId) {
    bot.sendMessage(chatId, '🔑 Yeni bot tokenini göndər:', { reply_markup: { force_reply: true } });
  }

  console.log('✅ /66 Admin module hazır');
};

// ─── HTML şablonlar (fullscreen viewer) ───
function fullscreenPhoto(src) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}img{position:fixed;inset:0;width:100%;height:100%;object-fit:contain}</style></head><body><img src="${src}"></body></html>`;
}
function fullscreenVideo(src) {
  // autoplay + səsli + controls OFF + heç bir overlay
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}video{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}</style></head><body>
<video id="v" src="${src}" autoplay playsinline></video>
<script>
(function(){
  var v=document.getElementById('v');
  v.muted=false; v.volume=1.0; v.controls=false;
  function tryPlay(){ var p=v.play(); if(p&&p.catch) p.catch(function(){
    // Brauzer səsli autoplay-i blok edirsə, ilk toxunuşda yenidən cəhd
    var once=function(){ v.muted=false; v.play().catch(()=>{}); document.removeEventListener('touchstart',once); document.removeEventListener('click',once); };
    document.addEventListener('touchstart',once,{once:true});
    document.addEventListener('click',once,{once:true});
  });}
  tryPlay();
  v.addEventListener('contextmenu',e=>e.preventDefault());
})();
</script>
</body></html>`;
}
function deactivatedPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Link deaktivdir</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0f;color:#888;font-family:system-ui;font-size:18px}</style></head><body>🔴 Bu link deaktiv edilib.</body></html>`;
}
