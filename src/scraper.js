// ============================================================
//  scraper.js — استخراج عروض العمل من Alwadifa و ANAPEC
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  'Accept-Language': 'ar,fr;q=0.9'
};

// ---------------- Alwadifa-Maroc.com ----------------
async function scrapeAlwadifa(pages = 2) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? 'https://alwadifa-maroc.com/' : `https://alwadifa-maroc.com/page/${p}`;
    try {
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 30000 });
      const $ = cheerio.load(data);
      $('article.content-card[data-id]').each((_, el) => {
        const $el = $(el);
        const id = 'alwadifa_' + String($el.attr('data-id') || '').replace(/\D/g, '');
        const a = $el.find('h2 a.title-link').first();
        const title = a.text().trim();
        const href = a.attr('href') || '';
        const link = href.startsWith('http') ? href : 'https://alwadifa-maroc.com' + href;
        const desc = $el.find('.content-description p').first().text().trim();
        const date = $el.find('.content-meta span').first().text().trim();
        const type = $el.find('.content-type').first().text().trim();
        if (id && title) out.push({ id, source: 'الوظيفة ماروك', title, desc, date, type, link });
      });
    } catch (e) {
      console.error('[Alwadifa] خطأ صفحة', p, ':', e.message);
    }
  }
  return out;
}

// ---------------- ANAPEC ----------------
// الموقع يعمل بـ Angular (SPA) — نحاول HTTP أولاً، ثم Chromium إن كان مفعّلاً
async function scrapeAnapec(headless = false) {
  const url = 'https://www.anapec.org/sigec-app-rv/fr/chercheurs/resultat_recherche/tout:all';

  // المحاولة 1: HTTP مباشر (يشتغل إن كان السيرفر يرسل HTML جاهزاً)
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 30000 });
    const parsed = parseAnapecHTML(data);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error('[ANAPEC] HTTP:', e.message);
  }

  // المحاولة 2: Chromium بدون واجهة (اختياري — ثبّته: pkg install chromium)
  if (headless) {
    try {
      const { execSync } = require('child_process');
      const tmp = '/tmp/anapec_render.html';
      const chromeBin = process.env.CHROME_BIN || 'chromium-browser';
      execSync(`${chromeBin} --headless --disable-gpu --no-sandbox --virtual-time-budget=15000 --dump-dom "${url}" > ${tmp} 2>/dev/null`, { timeout: 90000, shell: '/bin/sh' });
      const html = require('fs').readFileSync(tmp, 'utf8');
      const parsed = parseAnapecHTML(html);
      console.log('[ANAPEC] headless:', parsed.length, 'عرض');
      return parsed;
    } catch (e) {
      console.error('[ANAPEC] headless:', e.message);
    }
  } else {
    console.log('[ANAPEC] الموقع يتطلب متصفحاً — فعّل "ANAPEC عبر Chromium" من لوحة التحكم');
  }
  return [];
}

function parseAnapecHTML(html) {
  const out = [];
  const $ = cheerio.load(html);
  // محددات متعددة محتملة (الموقع Angular — نغطي أكثر من بنية)
  const cards = $('a[href*="offre"], .offre-item, .resultat-item, article, .card').filter((_, el) => {
    const href = $(el).attr('href') || $(el).find('a').attr('href') || '';
    return /offre|emploi|detail/i.test(href) || $(el).find('[class*="offre"], [class*="titre"]').length > 0;
  });
  cards.each((i, el) => {
    const $el = $(el);
    const a = $el.is('a') ? $el : $el.find('a').first();
    let href = a.attr('href') || '';
    if (href && !href.startsWith('http')) href = 'https://www.anapec.org' + href;
    const title = ($el.find('h1,h2,h3,h4,.titre,.title').first().text() || a.text()).trim();
    const idm = href.match(/(\d{3,})/);
    const id = 'anapec_' + (idm ? idm[1] : Buffer.from(title).toString('base64').slice(0, 12));
    const text = $el.text().replace(/\s+/g, ' ').trim();
    const desc = text.slice(0, 200);
    if (title && title.length > 8 && !out.some(o => o.id === id)) {
      out.push({ id, source: 'أنابيك', title, desc, date: new Date().toISOString().slice(0, 10), type: 'عرض عمل', link: href || 'https://www.anapec.org' });
    }
  });
  return out.slice(0, 30);
}

// ---------------- نقطة الدخول ----------------
async function scanAll(config) {
  let all = [];
  if (config.sources.alwadifa) all = all.concat(await scrapeAlwadifa(2));
  if (config.sources.anapec) all = all.concat(await scrapeAnapec(config.anapecHeadless));

  // فلترة بالكلمات المفتاحية إن وُجدت
  const kws = (config.keywords || '').split(/[,،]/).map(s => s.trim()).filter(Boolean);
  if (kws.length) {
    all = all.filter(j => kws.some(k => (j.title + ' ' + j.desc).toLowerCase().includes(k.toLowerCase())));
  }
  return all;
}

module.exports = { scanAll, scrapeAlwadifa, scrapeAnapec };
