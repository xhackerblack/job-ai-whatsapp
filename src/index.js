// ============================================================
//  index.js v3.1 — Runner: bot + scanner + deadline watcher + dashboard
//  All console logs in English (Termux has no Arabic font support)
// ============================================================
const store = require('./store');
const { scanAll } = require('./scraper');
const wa = require('./whatsapp');
const { startServer } = require('./server');

const PORT = process.env.PORT || 3000;
let scanning = false;
let timer = null;
let alertTimer = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Send unsent jobs to the group
async function sendPending() {
  const cfg = store.getConfig();
  if (cfg.paused) { console.log('[BOT] Paused — nothing sent'); return; }
  if (!cfg.groupJid) { console.log('[BOT] No WhatsApp group selected — pick one in the dashboard'); return; }
  const pending = store.getJobs().filter(j => !j.sent && !j.failed).slice(0, cfg.maxJobsPerScan);
  console.log(`[BOT] Sending ${pending.length} pending job(s)...`);
  for (const job of pending) {
    const ok = await wa.sendJob(job, cfg.groupJid);
    if (ok) {
      store.markSent([job.id]);
      console.log('[BOT] Sent:', job.title.slice(0, 50));
    } else {
      store.markFailed([job.id]);
      console.log('[BOT] Send deferred (will retry later):', job.title.slice(0, 40));
      break;
    }
  }
}

// Scan both sites and store new offers
async function runScan(manual = false) {
  const cfg0 = store.getConfig();
  if (cfg0.paused && !manual) return;
  if (scanning) { console.log('[SCAN] Another scan is already running...'); return; }
  scanning = true;
  console.log(manual ? '[SCAN] Manual scan started...' : '[SCAN] Scheduled scan started...');
  try {
    const cfg = store.getConfig();
    const found = await scanAll(cfg);
    const fresh = store.addJobs(found);
    store.saveConfig({ lastScan: new Date().toISOString() });
    console.log(`[SCAN] Done — found ${found.length} offers, new: ${fresh.length}`);
    if (fresh.length && cfg.autoSend && !cfg.paused) await sendPending();
  } catch (e) {
    console.error('[SCAN] Error:', e.message);
  } finally {
    scanning = false;
  }
}

// Clear ALL offers, rescan both sites, then send a fresh batch to the group
async function refreshAll() {
  console.log('[REFRESH] Clearing all offers and rescanning...');
  store.clearAllJobs();
  scanning = false;
  await runScan(true);
  await sendPending();
  console.log('[REFRESH] Done');
}

// ---------------- Deadline watcher: colored alerts ----------------
async function checkDeadlines() {
  const cfg = store.getConfig();
  if (!cfg.deadlineAlerts || cfg.paused || !cfg.groupJid) return;
  const now = Date.now();
  for (const job of store.getJobs()) {
    if (!job.deadlineDate) continue;
    const daysLeft = Math.ceil((new Date(job.deadlineDate).getTime() - now) / 864e5);

    if (daysLeft >= 0 && daysLeft <= cfg.alertDaysRed && !job.alerted_red) {
      console.log(`[ALERT] URGENT (${daysLeft}d):`, job.title.slice(0, 45));
      if (await wa.sendDeadlineAlert(job, cfg.groupJid, daysLeft)) store.markAlerted(job.id, 'red');
      await sleep(2500);
    }
    else if (daysLeft > cfg.alertDaysRed && daysLeft <= cfg.alertDaysYellow && !job.alerted_yellow) {
      console.log(`[ALERT] Soon (${daysLeft}d):`, job.title.slice(0, 45));
      if (await wa.sendDeadlineAlert(job, cfg.groupJid, daysLeft)) store.markAlerted(job.id, 'yellow');
      await sleep(2500);
    }
    else if (daysLeft < 0 && job.sent && !job.alerted_expired) {
      if (await wa.sendDeadlineAlert(job, cfg.groupJid, daysLeft)) store.markAlerted(job.id, 'expired');
      await sleep(2500);
    }
  }
}

// Human-like scheduling: base interval +/- up to 30% random jitter,
// so requests never hit the sites at perfectly regular intervals
function schedule() {
  if (timer) clearTimeout(timer);
  const mins = store.getConfig().scanIntervalMin || 30;
  const jitter = 0.7 + Math.random() * 0.6; // 70%..130% of the interval
  const next = Math.round(mins * 60 * 1000 * jitter);
  console.log(`[SCHEDULE] Next scan in ~${Math.round(next / 60000)} min (base ${mins} min + human jitter)`);
  timer = setTimeout(() => { runScan(false); schedule(); }, next);

  if (alertTimer) clearInterval(alertTimer);
  alertTimer = setInterval(checkDeadlines, 3 * 3600 * 1000);
}

// Interfaces used by the hidden WhatsApp commands and the dashboard
global.__runScan = runScan;
global.__sendPending = sendPending;
global.__refreshAll = refreshAll;

// Startup
(async () => {
  console.log('========================================');
  console.log('  Job AI v3.1 — WhatsApp Job Offers Bot');
  console.log('  Sources: ANAPEC + Alwadifa-Maroc');
  console.log('========================================');

  startServer(PORT, { runScan, sendPending, checkDeadlines, refreshAll });
  schedule();
  await wa.startBot(() => {
    store.resetFailed();
    setTimeout(() => runScan(false), 5000);
    setTimeout(checkDeadlines, 30000);
  });

  runScan(false);
})();
