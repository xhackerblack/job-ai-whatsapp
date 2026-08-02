// ============================================================
//  index.js v3 — التشغيل: البوت + الفاحص + مراقب آخر الأجل + اللوحة
// ============================================================
const store = require('./store');
const { scanAll } = require('./scraper');
const wa = require('./whatsapp');
const { startServer } = require('./server');

const PORT = process.env.PORT || 3000;
let scanning = false;
let timer = null;
let alertTimer = null;

// إرسال العروض غير المرسلة إلى المجموعة
async function sendPending() {
  const cfg = store.getConfig();
  if (cfg.paused) { console.log('⏸️ البوت متوقف مؤقتاً'); return; }
  if (!cfg.groupJid) { console.log('⚠️ لم تختر مجموعة واتساب بعد — اخترها من لوحة التحكم'); return; }
  const pending = store.getJobs().filter(j => !j.sent && !j.failed).slice(0, cfg.maxJobsPerScan);
  for (const job of pending) {
    const ok = await wa.sendJob(job, cfg.groupJid);
    if (ok) {
      store.markSent([job.id]);
      console.log('📤 أُرسل:', job.title.slice(0, 50));
    } else {
      store.markFailed([job.id]);
      console.log('⚠️ تأجل الإرسال (سيُعاد لاحقاً):', job.title.slice(0, 40));
      break;
    }
  }
}

// فحص المواقع وجلب الجديد
async function runScan(manual = false) {
  const cfg0 = store.getConfig();
  if (cfg0.paused && !manual) return;
  if (scanning) { console.log('⏳ فحص آخر جارٍ...'); return; }
  scanning = true;
  console.log(manual ? '🔍 فحص يدوي...' : '🔍 فحص تلقائي مجدول...');
  try {
    const cfg = store.getConfig();
    const found = await scanAll(cfg);
    const fresh = store.addJobs(found);
    store.saveConfig({ lastScan: new Date().toISOString() });
    console.log(`✅ وُجد ${found.length} عرض — الجديد: ${fresh.length}`);
    if (fresh.length && cfg.autoSend && !cfg.paused) await sendPending();
  } catch (e) {
    console.error('خطأ في الفحص:', e.message);
  } finally {
    scanning = false;
  }
}

// ---------------- مراقب آخر الأجل: تنبيهات ملوّنة ----------------
async function checkDeadlines() {
  const cfg = store.getConfig();
  if (!cfg.deadlineAlerts || cfg.paused || !cfg.groupJid) return;
  const now = Date.now();
  for (const job of store.getJobs()) {
    if (!job.deadlineDate) continue;
    const daysLeft = Math.ceil((new Date(job.deadlineDate).getTime() - now) / 864e5);

    // 🔴 عاجل: يومان أو أقل
    if (daysLeft >= 0 && daysLeft <= cfg.alertDaysRed && !job.alerted_red) {
      console.log(`🔴 تنبيه عاجل (${daysLeft} يوم):`, job.title.slice(0, 45));
      if (await wa.sendDeadlineAlert(job, cfg.groupJid, daysLeft)) store.markAlerted(job.id, 'red');
      await new Promise(r => setTimeout(r, 2500));
    }
    // 🟠 يقترب: أسبوع أو أقل
    else if (daysLeft > cfg.alertDaysRed && daysLeft <= cfg.alertDaysYellow && !job.alerted_yellow) {
      console.log(`🟠 تنبيه اقتراب (${daysLeft} أيام):`, job.title.slice(0, 45));
      if (await wa.sendDeadlineAlert(job, cfg.groupJid, daysLeft)) store.markAlerted(job.id, 'yellow');
      await new Promise(r => setTimeout(r, 2500));
    }
    // ⚫ منتهي: إشعار أخير مرة واحدة
    else if (daysLeft < 0 && job.sent && !job.alerted_expired) {
      if (await wa.sendDeadlineAlert(job, cfg.groupJid, daysLeft)) store.markAlerted(job.id, 'expired');
      await new Promise(r => setTimeout(r, 2500));
    }
  }
}

// جدولة الفحص التلقائي
function schedule() {
  if (timer) clearInterval(timer);
  const mins = store.getConfig().scanIntervalMin || 30;
  timer = setInterval(() => runScan(false), mins * 60 * 1000);
  console.log(`⏰ الفحص التلقائي كل ${mins} دقيقة`);
  // مراقب آخر الأجل: كل 3 ساعات
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = setInterval(checkDeadlines, 3 * 3600 * 1000);
}

// واجهات يستخدمها نظام الأوامر المخفية
global.__runScan = runScan;
global.__sendPending = sendPending;

// التشغيل
(async () => {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  🤖 Job AI v3 — بوت عروض العمل واتساب ║');
  console.log('╚══════════════════════════════════════╝');

  startServer(PORT, { runScan, sendPending, checkDeadlines });
  schedule();
  await wa.startBot(() => {
    store.resetFailed();
    setTimeout(() => runScan(false), 5000);
    setTimeout(checkDeadlines, 30000);
  });

  runScan(false);
})();
