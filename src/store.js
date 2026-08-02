// ============================================================
//  store.js v3 — تخزين: العروض + الإعدادات + إحصائيات الأعضاء + التنبيهات
// ============================================================
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultConfig = {
  groupJid: '',
  autoSend: true,
  paused: false,            // إيقاف مؤقت للبوت بالكامل
  scanIntervalMin: 30,
  keywords: '',
  sources: { alwadifa: true, anapec: true },
  maxJobsPerScan: 10,
  anapecHeadless: false,
  sendGif: true,            // إرفاق الصورة المتحركة مع كل عرض
  adminNumber: '',          // رقم الأدمن للأوامر المخفية (مثال: 2126XXXXXXXX)
  deadlineAlerts: true,     // تنبيهات اقتراب آخر الأجل
  alertDaysYellow: 7,       // 🟠 تنبيه أصفر قبل 7 أيام
  alertDaysRed: 2           // 🔴 تنبيه أحمر عاجل قبل يومين
};

function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return def; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let jobs = loadJSON(JOBS_FILE, []);
let config = { ...defaultConfig, ...loadJSON(CONFIG_FILE, {}) };
let stats = loadJSON(STATS_FILE, { groups: {} });

module.exports = {
  getJobs: () => jobs,
  getConfig: () => config,

  addJobs(newJobs) {
    const ids = new Set(jobs.map(j => j.id));
    const fresh = newJobs.filter(j => !ids.has(j.id));
    jobs = [...fresh, ...jobs].slice(0, 500);
    saveJSON(JOBS_FILE, jobs);
    return fresh;
  },
  markSent(ids) {
    jobs = jobs.map(j => ids.includes(j.id) ? { ...j, sent: true, failed: false } : j);
    saveJSON(JOBS_FILE, jobs);
  },
  markFailed(ids) {
    jobs = jobs.map(j => ids.includes(j.id) ? { ...j, failed: true } : j);
    saveJSON(JOBS_FILE, jobs);
  },
  resetFailed() {
    jobs = jobs.map(j => j.failed ? { ...j, failed: false } : j);
    saveJSON(JOBS_FILE, jobs);
  },
  deleteJob(id) {
    jobs = jobs.filter(j => j.id !== id);
    saveJSON(JOBS_FILE, jobs);
  },
  resetJob(id) { // إعادة عرض للإرسال من جديد
    jobs = jobs.map(j => j.id === id ? { ...j, sent: false, failed: false } : j);
    saveJSON(JOBS_FILE, jobs);
  },
  clearAllJobs() {
    jobs = [];
    saveJSON(JOBS_FILE, jobs);
  },
  markAlerted(id, level) { // level: yellow | red | expired
    jobs = jobs.map(j => j.id === id ? { ...j, ['alerted_' + level]: true } : j);
    saveJSON(JOBS_FILE, jobs);
  },

  saveConfig(patch) {
    config = { ...config, ...patch };
    saveJSON(CONFIG_FILE, config);
    return config;
  },

  // ---------------- إحصائيات أعضاء المجموعة ----------------
  trackMessage(groupJid, participantJid, name) {
    if (!groupJid || !participantJid) return;
    if (!stats.groups[groupJid]) stats.groups[groupJid] = {};
    const g = stats.groups[groupJid];
    if (!g[participantJid]) g[participantJid] = { count: 0, name: name || '', firstSeen: new Date().toISOString() };
    g[participantJid].count++;
    if (name) g[participantJid].name = name;
    g[participantJid].lastActive = new Date().toISOString();
    if (g[participantJid].count % 10 === 0) saveJSON(STATS_FILE, stats); // حفظ دوري
  },
  getGroupStats(groupJid) {
    const g = stats.groups[groupJid] || {};
    return Object.entries(g)
      .map(([jid, s]) => ({ jid, ...s }))
      .sort((a, b) => b.count - a.count);
  },
  flushStats() { saveJSON(STATS_FILE, stats); },

  stats() {
    return {
      total: jobs.length,
      sent: jobs.filter(j => j.sent).length,
      pending: jobs.filter(j => !j.sent && !j.failed).length,
      failed: jobs.filter(j => j.failed).length,
      withDeadline: jobs.filter(j => j.deadlineDate).length,
      expiringSoon: jobs.filter(j => j.deadlineDate && !j.expired && new Date(j.deadlineDate) > new Date() && (new Date(j.deadlineDate) - Date.now()) < 7 * 864e5).length,
      lastScan: config.lastScan || null
    };
  }
};
