// ============================================================
//  whatsapp.js — بوت واتساب عبر Baileys (مجاني 100% — بدون API)
//  يعمل مثل WhatsApp Web: امسح QR بواتسابك ويبدأ العمل
// ============================================================
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const pino = require('pino');

let sock = null;
let qrData = null;      // آخر QR (يُعرض في لوحة التحكم)
let status = 'offline'; // offline | qr | connecting | online
let groupsCache = [];

async function startBot(onReady) {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '..', 'data', 'auth'));
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Job AI Bot', 'Chrome', '1.0.0']
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
}

async function refreshGroups() {
  if (!sock || status !== 'online') return [];
  try {
    const g = await sock.groupFetchAllParticipating();
    groupsCache = Object.values(g).map(x => ({ jid: x.id, name: x.subject, members: x.participants.length }));
  } catch (e) { console.error('خطأ جلب المجموعات:', e.message); }
  return groupsCache;
}

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

async function sendJob(job, groupJid) {
  if (!sock || status !== 'online' || !groupJid) return false;
  try {
    await sock.sendMessage(groupJid, { text: formatJob(job) });
    await new Promise(r => setTimeout(r, 2000)); // تأخير بين الرسائل لتجنب الحظر
    return true;
  } catch (e) {
    console.error('خطأ إرسال:', e.message);
    return false;
  }
}

module.exports = {
  startBot,
  refreshGroups,
  sendJob,
  getStatus: () => ({ status, qr: qrData, groups: groupsCache })
};
