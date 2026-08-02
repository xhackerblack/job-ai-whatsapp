// ============================================================
//  commands.js — نظام الأوامر
//  🔐 أوامر الأدمن المخفية: تبدأ بـ "/" — يرى الرد الأدمن فقط (خاص)
//  👥 أوامر الأعضاء العامة: تبدأ بـ "#" — يرد البوت في المجموعة
// ============================================================
const store = require('./store');

// رقم الأدمن: من الإعدادات أو صاحب الحساب نفسه (fromMe)
function isAdmin(fromMe, participant, cfg) {
  if (fromMe) return true;
  if (cfg.adminNumber && participant) {
    const num = participant.replace(/\D/g, '');
    return num.includes(cfg.adminNumber.replace(/\D/g, ''));
  }
  return false;
}

function adminJid(cfg) {
  return cfg.adminNumber ? cfg.adminNumber.replace(/\D/g, '') + '@s.whatsapp.net' : null;
}

function bar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

async function handleCommand(ctx) {
  const { text, fromMe, isGroup, groupJid, participant, senderName, api } = ctx;
  const cfg = store.getConfig();

  // ============================================================
  //  👥 أوامر عامة للأعضاء (تبدأ بـ #) — تظهر في المجموعة
  // ============================================================
  if (text.startsWith('#')) {
    const cmd = text.slice(1).trim();

    // #احصائياتي — إحصائيات العضو نفسه
    if (/^(احصائياتي|إحصائياتي|حالتي|stats)/.test(cmd) && isGroup) {
      const all = store.getGroupStats(groupJid);
      const me = all.find(s => s.jid === participant);
      const rank = all.findIndex(s => s.jid === participant) + 1;
      const totalMsgs = all.reduce((a, s) => a + s.count, 0);
      if (!me) return { text: `📊 مرحباً ${senderName}!\nلم تُسجَّل لك رسائل بعد — تفاعل مع المجموعة لتظهر إحصائياتك.` };
      const pct = totalMsgs ? Math.round(me.count / totalMsgs * 100) : 0;
      return { text:
`📊 *إحصائياتك — ${senderName}*
━━━━━━━━━━━━━━━
💬 رسائلك في المجموعة: *${me.count}*
🏆 ترتيبك: *#${rank}* من ${all.length} عضو نشط
📈 نشاطك: ${bar(pct)} ${pct}%
🕐 آخر نشاط: ${new Date(me.lastActive).toLocaleString('ar')}
━━━━━━━━━━━━━━━
🤖 _Job AI_` };
    }

    // #المتصدرون — أفضل 5 أعضاء تفاعلاً
    if (/^(المتصدرون|الترتيب|top)/.test(cmd) && isGroup) {
      const all = store.getGroupStats(groupJid).slice(0, 5);
      if (!all.length) return { text: '📊 لا توجد إحصائيات بعد.' };
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const max = all[0].count || 1;
      return { text:
`🏆 *المتصدرون في التفاعل*
━━━━━━━━━━━━━━━
` + all.map((s, i) =>
  `${medals[i]} *${s.name || s.jid.split('@')[0]}*\n   💬 ${s.count} رسالة  ${bar(Math.round(s.count / max * 100))}`
).join('\n') + `\n━━━━━━━━━━━━━━━\n🤖 _Job AI_` };
    }

    // #عروض — آخر 5 عروض
    if (/^(عروض|وظائف|jobs)/.test(cmd)) {
      const jobs = store.getJobs().filter(j => j.sent).slice(0, 5);
      if (!jobs.length) return { text: '📭 لا توجد عروض منشورة بعد.' };
      return { text:
`💼 *آخر ${jobs.length} عروض منشورة:*
━━━━━━━━━━━━━━━
` + jobs.map((j, i) => `${i + 1}. *${j.title.slice(0, 60)}*${j.deadline ? `\n   ⏳ ${j.deadline}` : ''}\n   🔗 ${j.link}`).join('\n\n') + `\n━━━━━━━━━━━━━━━\n🤖 _Job AI_` };
    }

    return null; // أمر عام غير معروف — تجاهل بصمت
  }

  // ============================================================
  //  🔐 أوامر الأدمن المخفية (تبدأ بـ /) — الرد خاص للأدمن فقط
  // ============================================================
  if (!text.startsWith('/')) return null;
  if (!isAdmin(fromMe, participant, cfg)) return null; // تجاهل صامت — مخفي تماماً

  const cmd = text.slice(1).trim();
  const replyPrivate = { private: true, adminJid: adminJid(cfg) };
  const st = store.stats();

  // /مساعدة
  if (/^(مساعدة|help|بدا)/.test(cmd)) {
    return { ...replyPrivate, text:
`🔐 *لوحة أوامر الأدمن — Job AI*
━━━━━━━━━━━━━━━
📊 /حالة — حالة البوت الكاملة
🔍 /فحص — فحص المواقع فوراً
📤 /ارسل — إرسال العروض المعلّقة
⏸️ /ايقاف — إيقاف البوت مؤقتاً
▶️ /تشغيل — استئناف البوت
🖼️ /صورة_تشغيل | /صورة_ايقاف — الصورة المتحركة
⏰ /تنبيهات_تشغيل | /تنبيهات_ايقاف — تنبيهات الأجل
🏆 /ترتيب — ترتيب أعضاء المجموعة
👥 /مجموعات — قائمة مجموعاتك
📋 /معلقة — العروض المعلّقة
🗑️ /مسح_فاشلة — تصفير الفاشلة
♻️ /اعادة_الكل — إعادة إرسال كل العروض
🔄 /تحديث_الكل — مسح كل العروض + فحص + إرسال دفعة
❓ /مساعدة — هذه القائمة
━━━━━━━━━━━━━━━
_الأوامر مخفية — لا يراها الأعضاء_ 🤫` };
  }

  // /حالة
  if (/^(حالة|status)/.test(cmd)) {
    return { ...replyPrivate, text:
`📊 *حالة البوت*
━━━━━━━━━━━━━━━
${api.isOnline() ? '🟢 واتساب: متصل' : '🔴 واتساب: غير متصل'}
${cfg.paused ? '⏸️ البوت: متوقف مؤقتاً' : '▶️ البوت: يعمل'}
💼 إجمالي العروض: *${st.total}*
✅ مُرسلة: *${st.sent}* | ⏳ معلّقة: *${st.pending}* | ❌ فاشلة: *${st.failed}*
⏳ عروض بآخر أجل قريب (7 أيام): *${st.expiringSoon}*
🖼️ الصورة المتحركة: ${cfg.sendGif ? 'مفعّلة ✅' : 'معطّلة ❌'}
⏰ تنبيهات الأجل: ${cfg.deadlineAlerts ? 'مفعّلة ✅' : 'معطّلة ❌'}
🔄 الفحص التلقائي: كل ${cfg.scanIntervalMin} دقيقة
🕐 آخر فحص: ${st.lastScan ? new Date(st.lastScan).toLocaleString('ar') : '—'}
━━━━━━━━━━━━━━━` };
  }

  // /فحص
  if (/^فحص/.test(cmd)) {
    if (global.__runScan) setTimeout(() => global.__runScan(true), 500);
    return { ...replyPrivate, text: '🔍 بدأ الفحص اليدوي... ستصلك النتائج تباعاً.' };
  }

  // /ارسل
  if (/^ارسل/.test(cmd)) {
    if (global.__sendPending) setTimeout(() => global.__sendPending(), 500);
    return { ...replyPrivate, text: `📤 جارٍ إرسال ${st.pending} عرضاً معلّقاً...` };
  }

  // /ايقاف و /تشغيل
  if (/^ايقاف/.test(cmd)) {
    store.saveConfig({ paused: true });
    return { ...replyPrivate, text: '⏸️ تم إيقاف البوت مؤقتاً — لا إرسال ولا فحص تلقائي حتى أمر /تشغيل' };
  }
  if (/^تشغيل/.test(cmd)) {
    store.saveConfig({ paused: false });
    return { ...replyPrivate, text: '▶️ البوت يعمل من جديد ✅' };
  }

  // /صورة_تشغيل /صورة_ايقاف
  if (/^صورة_تشغيل/.test(cmd)) {
    store.saveConfig({ sendGif: true });
    return { ...replyPrivate, text: '🖼️ تم تفعيل الصورة المتحركة مع العروض ✅' };
  }
  if (/^صورة_ايقاف/.test(cmd)) {
    store.saveConfig({ sendGif: false });
    return { ...replyPrivate, text: '🖼️ تم تعطيل الصورة المتحركة ❌' };
  }

  // /تنبيهات_تشغيل /تنبيهات_ايقاف
  if (/^تنبيهات_تشغيل/.test(cmd)) {
    store.saveConfig({ deadlineAlerts: true });
    return { ...replyPrivate, text: '⏰ تنبيهات آخر الأجل مفعّلة ✅' };
  }
  if (/^تنبيهات_ايقاف/.test(cmd)) {
    store.saveConfig({ deadlineAlerts: false });
    return { ...replyPrivate, text: '⏰ تنبيهات آخر الأجل معطّلة ❌' };
  }

  // /ترتيب — إحصائيات كاملة للأدمن
  if (/^ترتيب/.test(cmd)) {
    const target = isGroup ? groupJid : cfg.groupJid;
    const all = store.getGroupStats(target);
    if (!all.length) return { ...replyPrivate, text: '📊 لا توجد إحصائيات أعضاء بعد.' };
    const totalMsgs = all.reduce((a, s) => a + s.count, 0);
    return { ...replyPrivate, text:
`🏆 *ترتيب الأعضاء الكامل* (للأدمن)
━━━━━━━━━━━━━━━
👥 أعضاء نشطون: ${all.length} | 💬 مجموع الرسائل: ${totalMsgs}
━━━━━━━━━━━━━━━
` + all.slice(0, 15).map((s, i) => {
  const pct = totalMsgs ? Math.round(s.count / totalMsgs * 100) : 0;
  return `${i + 1}. *${s.name || s.jid.split('@')[0]}* — ${s.count} 💬 (${pct}%)\n   ${bar(pct)}`;
}).join('\n') };
  }

  // /مجموعات
  if (/^مجموعات/.test(cmd)) {
    const groups = await api.refreshGroups();
    return { ...replyPrivate, text:
`👥 *مجموعاتك (${groups.length}):*\n` +
groups.map((g, i) => `${i + 1}. ${g.name} — ${g.members} عضو`).join('\n') +
`\n\n📌 مجموعة النشر الحالية: ${cfg.groupJid ? groups.find(g => g.jid === cfg.groupJid)?.name || cfg.groupJid : '❌ لم تُختر'}` };
  }

  // /معلقة
  if (/^معلقة/.test(cmd)) {
    const pending = store.getJobs().filter(j => !j.sent && !j.failed).slice(0, 10);
    if (!pending.length) return { ...replyPrivate, text: '✅ لا توجد عروض معلّقة — كل شيء مُرسل!' };
    return { ...replyPrivate, text: `⏳ *العروض المعلّقة (${st.pending}):*\n` + pending.map((j, i) => `${i + 1}. ${j.title.slice(0, 50)}`).join('\n') };
  }

  // /مسح_فاشلة
  if (/^مسح_فاشلة/.test(cmd)) {
    store.resetFailed();
    return { ...replyPrivate, text: '♻️ تم تصفير العروض الفاشلة — ستُعاد محاولة إرسالها.' };
  }

  // /تحديث_الكل — مسح كل العروض ثم فحص الموقعين وإرسال دفعة جديدة
  if (/^تحديث_الكل/.test(cmd)) {
    if (global.__refreshAll) setTimeout(() => global.__refreshAll(), 500);
    return { ...replyPrivate, text: '🔄 سيتم مسح جميع العروض، ثم فحص الموقعين، ثم إرسال دفعة جديدة للمجموعة...' };
  }

  // /اعادة_الكل
  if (/^اعادة_الكل/.test(cmd)) {
    store.getJobs().forEach(j => store.resetJob(j.id));
    return { ...replyPrivate, text: '⚠️ تم تصفير حالة الإرسال لكل العروض — استخدم /ارسل لإعادة نشرها.' };
  }

  return { ...replyPrivate, text: '❓ أمر غير معروف — اكتب /مساعدة لعرض الأوامر.' };
}

module.exports = { handleCommand };
