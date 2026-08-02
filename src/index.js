// ============================================================
//  index.js — نقطة تشغيل المشروع (البوت + الفاحص + اللوحة)
// ============================================================
const store = require('./store');
const { scanAll } = require('./scraper');
const wa = require('./whatsapp');
const { startServer } = require('./server');

const PORT = process.env.PORT || 3000;
let scanning = false;
let timer = null;

// إرسال العروض غير المرسلة إلى المجموعة
async function sendPending() {
  const cfg = store.getConfig();
  if (!cfg.groupJid) { console.log('⚠️ لم تختر مجموعة واتساب بعد — اخترها من لوحة التحكم'); return; }
  const pending = store.getJobs().filter(j => !j.sent).slice(0, cfg.maxJobsPerScan);
  for (const job of pending) {
    const ok = await wa.sendJob(job, cfg.groupJid);
    if (ok) {
      store.markSent([job.id]);
      console.log('📤 أُرسل:', job.title.slice(0, 50));
    }
  }
}

// فحص المواقع وجلب الجديد
async function runScan(manual = false) {
  if (scanning) { console.log('⏳ فحص آخر جارٍ...'); return; }
  scanning = true;
  console.log(manual ? '🔍 فحص يدوي...' : '🔍 فحص تلقائي مجدول...');
  try {
    const cfg = store.getConfig();
    const found = await scanAll(cfg);
    const fresh = store.addJobs(found);
    store.saveConfig({ lastScan: new Date().toISOString() });
    console.log(`✅ وُجد ${found.length} عرض — الجديد: ${fresh.length}`);
    if (fresh.length && cfg.autoSend) await sendPending();
  } catch (e) {
    console.error('خطأ في الفحص:', e.message);
  } finally {
    scanning = false;
  }
}

// جدولة الفحص التلقائي
function schedule() {
  if (timer) clearInterval(timer);
  const mins = store.getConfig().scanIntervalMin || 30;
  timer = setInterval(() => runScan(false), mins * 60 * 1000);
  console.log(`⏰ الفحص التلقائي كل ${mins} دقيقة`);
}

// التشغيل
(async () => {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   🤖 Job AI — بوت عروض العمل واتساب   ║');
  console.log('╚══════════════════════════════════════╝');

  startServer(PORT, { runScan, sendPending });
  schedule();
  await wa.startBot(() => {
    // أول فحص بعد اتصال واتساب
    setTimeout(() => runScan(false), 5000);
  });

  // فحص أولي حتى قبل اتصال واتساب (لتجميع العروض)
  runScan(false);
})();
