// ============================================================
//  server.js v3.1 — Dashboard server (full bot & jobs control)
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const wa = require('./whatsapp');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// الحالة العامة
app.get('/api/status', (req, res) => {
  res.json({ whatsapp: wa.getStatus(), stats: store.stats(), config: store.getConfig() });
});

// العروض (مع بحث)
app.get('/api/jobs', (req, res) => {
  const page = +(req.query.page || 1), limit = +(req.query.limit || 30);
  const q = (req.query.q || '').toLowerCase();
  let jobs = store.getJobs();
  if (q) jobs = jobs.filter(j => (j.title + ' ' + (j.employer || '') + ' ' + (j.city || '')).toLowerCase().includes(q));
  res.json({ total: jobs.length, page, jobs: jobs.slice((page - 1) * limit, page * limit) });
});

// حذف عرض
app.post('/api/jobs/delete', (req, res) => {
  store.deleteJob(req.body.id);
  res.json({ ok: true });
});

// إعادة إرسال عرض
app.post('/api/jobs/resend', (req, res) => {
  store.resetJob(req.body.id);
  const sendPending = req.app.get('sendPending');
  if (sendPending) setTimeout(sendPending, 500);
  res.json({ ok: true });
});

// مسح كل العروض
app.post('/api/jobs/clear', (req, res) => {
  store.clearAllJobs();
  res.json({ ok: true });
});

// مسح كل العروض + فحص + إرسال دفعة (تحديث شامل)
app.post('/api/refresh-all', (req, res) => {
  const refreshAll = req.app.get('refreshAll');
  if (refreshAll) setTimeout(refreshAll, 300);
  res.json({ ok: true });
});

// إحصائيات أعضاء المجموعة
app.get('/api/members', (req, res) => {
  const cfg = store.getConfig();
  res.json(store.getGroupStats(cfg.groupJid));
});

// المجموعات
app.get('/api/groups', async (req, res) => {
  res.json(await wa.refreshGroups());
});

// تحديث الإعدادات
app.post('/api/config', (req, res) => {
  res.json(store.saveConfig(req.body));
});

// إيقاف/تشغيل البوت
app.post('/api/bot/pause', (req, res) => res.json(store.saveConfig({ paused: true })));
app.post('/api/bot/resume', (req, res) => res.json(store.saveConfig({ paused: false })));

// فحص يدوي
app.post('/api/scan', async (req, res) => {
  res.json({ ok: true, message: 'scan started' });
  const runScan = req.app.get('runScan');
  if (runScan) runScan(true);
});

// إرسال العروض المعلّقة يدوياً
app.post('/api/send-pending', async (req, res) => {
  const sendPending = req.app.get('sendPending');
  if (sendPending) sendPending();
  res.json({ ok: true });
});

// فحص تنبيهات آخر الأجل يدوياً
app.post('/api/check-deadlines', (req, res) => {
  const checkDeadlines = req.app.get('checkDeadlines');
  if (checkDeadlines) checkDeadlines();
  res.json({ ok: true });
});

// رسالة تجريبية للمجموعة (للتأكد أن كل شيء يعمل)
app.post('/api/test-send', async (req, res) => {
  const cfg = store.getConfig();
  if (!cfg.groupJid) return res.json({ ok: false, error: 'no group selected' });
  const jobs = store.getJobs();
  const sample = jobs[0] || { title: 'عرض تجريبي', source: 'Job AI', desc: 'هذه رسالة تجريبية للتأكد من عمل البوت', link: 'https://github.com/xhackerblack/job-ai-whatsapp', date: new Date().toISOString().slice(0, 10), deadline: '' };
  const ok = await wa.sendJob(sample, cfg.groupJid);
  res.json({ ok });
});

// مسح سجل الربط (لإعادة الربط برقم آخر)
app.post('/api/logout', (req, res) => {
  const authDir = path.join(__dirname, '..', 'data', 'auth');
  if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
  res.json({ ok: true, message: 'session cleared — restart the bot' });
});

function startServer(port, deps) {
  app.set('runScan', deps.runScan);
  app.set('sendPending', deps.sendPending);
  app.set('checkDeadlines', deps.checkDeadlines);
  app.set('refreshAll', deps.refreshAll);
  app.listen(port, () => console.log(`\n[DASHBOARD] Control panel: http://localhost:${port}\n`));
}

module.exports = { startServer };
