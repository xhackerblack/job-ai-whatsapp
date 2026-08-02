// ============================================================
//  whatsapp.js v3 — بوت Baileys + صورة متحركة + أوامر مخفية + إحصائيات
// ============================================================
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const store = require('./store');
const { handleCommand } = require('./commands');
const { ensureGif } = require('./assets_embed');

let sock = null;
let qrData = null;
let status = 'offline'; // offline | qr | online
let groupsCache = [];

const GIF_MP4 = ensureGif(); // استخراج الصورة المتحركة عند أول تشغيل

async function startBot(onReady) {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '..', 'data', 'auth'));
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Job AI Bot', 'Chrome', '3.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      qrData = qr;
      status = 'qr';
      console.log('\n📱 امسح رمز QR التالي بواتسابك (الأجهزة المرتبطة ← ربط جهاز):\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      status = 'online';
      qrData = null;
      console.log('✅ واتساب متصل بنجاح!');
      await refreshGroups();
      if (onReady) onReady();
    }
    if (connection === 'close') {
      status = 'offline';
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('🔄 إعادة الاتصال...');
        setTimeout(() => startBot(onReady), 5000);
      } else {
        console.log('⚠️ تم تسجيل الخروج — احذف مجلد data/auth وأعد التشغيل');
      }
    }
  });

  // ---------------- استقبال الرسائل: أوامر مخفية + تتبع الإحصائيات ----------------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid?.endsWith('@g.us');
        const fromMe = msg.key.fromMe;
        const participant = isGroup ? msg.key.participant : remoteJid;
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || '';
        const name = msg.pushName || '';

        // تتبع إحصائيات أعضاء المجموعة (رسائل حقيقية فقط)
        if (isGroup && !fromMe && participant) {
          store.trackMessage(remoteJid, participant, name);
        }

        if (!text.trim()) continue;

        // معالجة الأوامر (المخفية للأدمن + العامة للأعضاء)
        const reply = await handleCommand({
          text: text.trim(),
          fromMe,
          isGroup,
          groupJid: remoteJid,
          participant,
          senderName: name,
          api: botAPI
        });

        if (reply) {
          // الأوامر المخفية تُرسل خاصة للأدمن، العامة تُرسل في نفس المحادثة
          const target = reply.private ? (reply.adminJid || remoteJid) : remoteJid;
          await sock.sendMessage(target, { text: reply.text }, reply.private ? {} : { quoted: msg });
        }
      } catch (e) {
        console.error('خطأ معالجة رسالة:', e.message);
      }
    }
  });
}

async function refreshGroups() {
  if (!sock || status !== 'online') return [];
  try {
    const g = await sock.groupFetchAllParticipating();
    groupsCache = Object.values(g).map(x => ({ jid: x.id, name: x.subject, members: x.participants.length }));
  } catch (e) { console.error('خطأ جلب المجموعات:', e.message); }
  return groupsCache;
}

// ---------------- تنسيق رسالة العرض ----------------
function formatJob(j) {
  return `🎯 *عرض عمل جديد — ${j.source}*\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📌 *${j.title}*\n` +
    (j.employer ? `🏢 المؤسسة: ${j.employer}\n` : '') +
    (j.contract ? `📋 نوع العقد: ${j.contract}\n` : '') +
    (j.city ? `📍 المدينة: ${j.city}\n` : '') +
    (j.type && !j.contract ? `🏷️ التصنيف: ${j.type}\n` : '') +
    (j.date ? `📅 تاريخ النشر: ${j.date}\n` : '') +
    (j.deadline ? `⏳ *آخر أجل للترشيح: ${j.deadline}*\n` : '') +
    (j.desc ? `\n📝 ${j.desc.slice(0, 250)}...\n` : '') +
    `\n🔗 *رابط الترشيح والتفاصيل:*\n${j.link}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🤖 _Job AI — خدمة البحث عن العمل_`;
}

// ---------------- إرسال عرض (صورة متحركة + نص) ----------------
async function sendJob(job, groupJid) {
  if (!sock || status !== 'online' || !groupJid) return false;
  try {
    const cfg = store.getConfig();
    // 1) الصورة المتحركة كـ GIF حي داخل واتساب
    if (cfg.sendGif && fs.existsSync(GIF_MP4)) {
      await sock.sendMessage(groupJid, {
        video: fs.readFileSync(GIF_MP4),
        gifPlayback: true,
        caption: `🆕 *وصل عرض عمل جديد!*`
      });
      await new Promise(r => setTimeout(r, 1500));
    }
    // 2) نص العرض الكامل
    await sock.sendMessage(groupJid, { text: formatJob(job) });
    await new Promise(r => setTimeout(r, 2000));
    return true;
  } catch (e) {
    console.error('خطأ إرسال:', e.message);
    return false;
  }
}

// ---------------- تنبيه اقتراب آخر الأجل (بألوان) ----------------
function urgencyBanner(daysLeft) {
  if (daysLeft < 0)  return { icon: '⚫', label: 'انتهى الأجل', color: '⚫⚫⚫' };
  if (daysLeft <= 2) return { icon: '🔴', label: 'عاجل — ينتهي قريباً جداً', color: '🔴🔴🔴' };
  if (daysLeft <= 7) return { icon: '🟠', label: 'تنبيه — الأجل يقترب', color: '🟠🟠🟠' };
  return { icon: '🟢', label: 'متاح', color: '🟢🟢🟢' };
}

async function sendDeadlineAlert(job, groupJid, daysLeft) {
  if (!sock || status !== 'online' || !groupJid) return false;
  const u = urgencyBanner(daysLeft);
  const expired = daysLeft < 0;
  const text =
    `${u.color}\n` +
    `${u.icon} *تنبيه آخر الأجل — ${u.label}*\n` +
    `${u.color}\n\n` +
    `📌 *${job.title}*\n` +
    (job.employer ? `🏢 ${job.employer}\n` : '') +
    (expired
      ? `⚫ *انتهى أجل الترشيح لهذا العرض* (${job.deadline})\n`
      : `⏳ *متبقٍ ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'} فقط!*\n📅 آخر أجل: ${job.deadline}\n`) +
    `\n🔗 رابط الترشيح:\n${job.link}\n` +
    (expired ? '' : `\n⚡ _سارعوا بإيداع ملفات الترشيح قبل فوات الأوان_`);
  try {
    if (fs.existsSync(GIF_MP4) && !expired) {
      await sock.sendMessage(groupJid, { video: fs.readFileSync(GIF_MP4), gifPlayback: true, caption: `${u.icon} تنبيه مهم!` });
      await new Promise(r => setTimeout(r, 1500));
    }
    await sock.sendMessage(groupJid, { text });
    return true;
  } catch (e) {
    console.error('خطأ تنبيه:', e.message);
    return false;
  }
}

async function sendText(jid, text) {
  if (!sock || status !== 'online') return false;
  try { await sock.sendMessage(jid, { text }); return true; }
  catch { return false; }
}

// واجهة يستخدمها نظام الأوامر وباقي الوحدات
const botAPI = {
  sendText,
  sendJob,
  sendDeadlineAlert,
  refreshGroups,
  getSock: () => sock,
  isOnline: () => status === 'online'
};

module.exports = {
  startBot,
  refreshGroups,
  sendJob,
  sendText,
  sendDeadlineAlert,
  urgencyBanner,
  botAPI,
  getStatus: () => ({ status, qr: qrData, groups: groupsCache })
};
