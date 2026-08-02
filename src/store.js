// ============================================================
//  store.js — قاعدة بيانات JSON بسيطة (العروض + الإعدادات)
// ============================================================
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultConfig = {
  groupJid: '',            // معرّف مجموعة الواتساب المستهدفة
  autoSend: true,          // إرسال تلقائي للعروض الجديدة
  scanIntervalMin: 30,     // الفحص كل 30 دقيقة
  keywords: '',            // فلترة بكلمات مفتاحية (اختياري، مفصولة بفواصل)
  sources: { alwadifa: true, anapec: true },
  maxJobsPerScan: 10,      // أقصى عدد عروض ترسل دفعة واحدة
  anapecHeadless: false    // تفعيل Chromium لاستخراج ANAPEC (يتطلب تثبيت chromium)
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

module.exports = {
  getJobs: () => jobs,
  getConfig: () => config,
  addJobs(newJobs) {
    const ids = new Set(jobs.map(j => j.id));
    const fresh = newJobs.filter(j => !ids.has(j.id));
    jobs = [...fresh, ...jobs].slice(0, 500); // نحتفظ بآخر 500 عرض
    saveJSON(JOBS_FILE, jobs);
    return fresh;
  },
  markSent(ids) {
    jobs = jobs.map(j => ids.includes(j.id) ? { ...j, sent: true } : j);
    saveJSON(JOBS_FILE, jobs);
  },
  saveConfig(patch) {
    config = { ...config, ...patch };
    saveJSON(CONFIG_FILE, config);
    return config;
  },
  stats() {
    return {
      total: jobs.length,
      sent: jobs.filter(j => j.sent).length,
      pending: jobs.filter(j => !j.sent).length,
      lastScan: config.lastScan || null
    };
  }
};
