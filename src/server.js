// ============================================================
//  server.js — خادم لوحة التحكم (Express API)
// ============================================================
const express = require('express');
const path = require('path');
const store = require('./store');
const wa = require('./whatsapp');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// الحالة العامة
app.get('/api/status', (req, res) => {
  res.json({ whatsapp: wa.getStatus(), stats: store.stats(), config: store.getConfig() });
});

// العروض
app.get('/api/jobs', (req, res) => {
  const page = +(req.query.page || 1), limit = +(req.query.limit || 30);
  const jobs = store.getJobs();
  res.json({ total: jobs.length, page, jobs: jobs.slice((page - 1) * limit, page * limit) });
});

// المجموعات
app.get('/api/groups', async (req, res) => {
  res.json(await wa.refreshGroups());
});

// تحديث الإعدادات
app.post('/api/config', (req, res) => {
  res.json(store.saveConfig(req.body));
});

// فحص يدوي
app.post('/api/scan', async (req, res) => {
  res.json({ ok: true, message: 'بدأ الفحص...' });
  const runScan = req.app.get('runScan');
  if (runScan) runScan(true);
});

// إرسال العروض المعلّقة يدوياً
app.post('/api/send-pending', async (req, res) => {
  const sendPending = req.app.get('sendPending');
  if (sendPending) sendPending();
  res.json({ ok: true });
});

// مسح سجل الربط (لإعادة الربط برقم آخر)
app.post('/api/logout', (req, res) => {
  const fs = require('fs');
  const authDir = path.join(__dirname, '..', 'data', 'auth');
  if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
  res.json({ ok: true, message: 'تم المسح — أعد تشغيل البوت' });
});

function startServer(port, deps) {
  app.set('runScan', deps.runScan);
  app.set('sendPending', deps.sendPending);
  app.listen(port, () => console.log(`\n🖥️  لوحة التحكم: http://localhost:${port}\n`));
}

module.exports = { startServer };
