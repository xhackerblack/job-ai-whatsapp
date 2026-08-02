// ============================================================
//  scraper.js v2 — استخراج معمّق لعروض العمل
//  Alwadifa: العنوان + الوصف الكامل + آخر أجل الترشيح + المؤسسة
//  ANAPEC: عنوان الوظيفة + المرجع + نوع العقد + المدينة + آخر أجل
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const path = require('path');
const fs = require('fs');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  'Accept-Language': 'ar,fr;q=0.9'
};

// بعض المواقع المغربية شهاداتها غير مكتملة السلسلة — نتجاوز التحقق لها فقط
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// مجلد مؤقت متوافق مع Termux
const TMP_DIR = process.env.TMPDIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// جلب مع إعادة محاولة تلقائية
async function fetchWithRetry(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, { headers: HEADERS, timeout: 30000, ...opts });
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ---------------- استخراج "آخر أجل" من أي نص (عربي + فرنسي) ----------------
const AR_MONTHS = 'يناير|فبراير|مارس|أبريل|ابريل|ماي|مايو|يونيو|يونيه|يوليوز|يوليو|غشت|أغسطس|شتنبر|سبتمبر|أكتوبر|اكتوبر|نونبر|نوفمبر|دجنبر|ديسمبر';
const FR_MONTHS = 'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre';

function extractDeadline(text) {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ');
  // عربي: "آخر أجل هو 17 غشت 2026" / "آخر أجل لإيداع الترشيحات: 20 شتنبر 2026"
  let m = t.match(new RegExp(`آخر أجل[^0-9]{0,40}?([0-9]{1,2}\\s+(?:${AR_MONTHS})\\s+[0-9]{4})`, 'i'));
  if (m) return m[1];
  // فرنسي: "Date limite ... 17 août 2026" / "avant le 17/08/2026"
  m = t.match(new RegExp(`(?:date\\s*limite|avant\\s*le|deadline)[^0-9]{0,30}?([0-9]{1,2}(?:\\s+(?:${FR_MONTHS})\\s+|\\/|-)[0-9]{1,4}(?:\\s*[0-9]{2,4})?)`, 'i'));
  if (m) return m[1];
  // تاريخ رقمي قرب كلمة أجل: "آخر أجل 17/08/2026"
  m = t.match(/آخر أجل[^0-9]{0,30}?([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/);
  if (m) return m[1];
  return '';
}

// استخراج اسم المؤسسة/الشركة من العنوان (الجزء قبل النقطتين غالباً)
function extractEmployer(title) {
  const m = (title || '').match(/^([^:：]{3,60})[:：]/);
  return m ? m[1].trim() : '';
}

// ---------------- تحويل نص "آخر أجل" إلى تاريخ حقيقي للتنبيهات ----------------
const AR_MONTH_MAP = {
  'يناير':0,'فبراير':1,'مارس':2,'أبريل':3,'ابريل':3,'ماي':4,'مايو':4,'يونيو':5,'يونيه':5,
  'يوليوز':6,'يوليو':6,'غشت':7,'أغسطس':7,'شتنبر':8,'سبتمبر':8,'أكتوبر':9,'اكتوبر':9,
  'نونبر':10,'نوفمبر':10,'دجنبر':11,'ديسمبر':11
};
const FR_MONTH_MAP = {
  'janvier':0,'février':1,'fevrier':1,'mars':2,'avril':3,'mai':4,'juin':5,'juillet':6,
  'août':7,'aout':7,'septembre':8,'octobre':9,'novembre':10,'décembre':11,'decembre':11
};

function parseDeadlineDate(dl) {
  if (!dl) return null;
  dl = dl.trim();
  // عربي: "17 غشت 2026"
  let m = dl.match(new RegExp(`([0-9]{1,2})\\s+(${AR_MONTHS})\\s+([0-9]{4})`));
  if (m) return new Date(+m[3], AR_MONTH_MAP[m[2]], +m[1], 23, 59).toISOString();
  // فرنسي: "17 août 2026"
  m = dl.match(new RegExp(`([0-9]{1,2})\\s+(${FR_MONTHS})\\s+([0-9]{4})`, 'i'));
  if (m) return new Date(+m[3], FR_MONTH_MAP[m[2].toLowerCase()], +m[1], 23, 59).toISOString();
  // رقمي: 17/08/2026
  m = dl.match(/([0-9]{1,2})[\/\-.]([0-9]{1,2})[\/\-.]([0-9]{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[2] - 1, +m[1], 23, 59).toISOString();
  }
  return null;
}

// ============================================================
//  Alwadifa-Maroc.com — الصفحة الرئيسية + صفحة التفاصيل
// ============================================================
async function scrapeAlwadifa(pages = 2, enrichDetails = true) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? 'https://alwadifa-maroc.com/' : `https://alwadifa-maroc.com/offre/index?page=${p}`;
    try {
      const { data } = await fetchWithRetry(url);
      const $ = cheerio.load(data);
      $('article.content-card[data-id]').each((_, el) => {
        const $el = $(el);
        const numId = String($el.attr('data-id') || '').replace(/\D/g, '');
        const a = $el.find('h2 a.title-link').first();
        const title = a.text().trim();
        const href = a.attr('href') || '';
        const link = href.startsWith('http') ? href : 'https://alwadifa-maroc.com' + href;
        const desc = $el.find('.content-description p').first().text().trim();
        const date = $el.find('.content-meta span').first().text().trim();
        const type = $el.find('.content-type').first().text().trim();
        if (numId && title) {
          out.push({
            id: 'alwadifa_' + numId,
            source: 'الوظيفة ماروك',
            title,
            desc,
            date,
            type,
            link,
            deadline: extractDeadline(title + ' ' + desc),  // آخر أجل غالباً في العنوان
            deadlineDate: parseDeadlineDate(extractDeadline(title + ' ' + desc)),
            employer: extractEmployer(title),
            city: '',
            contract: ''
          });
        }
      });
    } catch (e) {
      console.error('[Alwadifa] خطأ صفحة', p, ':', e.message);
    }
  }

  // إثراء أحدث العروض بفتح صفحة التفاصيل (وصف كامل + آخر أجل دقيق)
  if (enrichDetails) {
    const toEnrich = out.slice(0, 12); // أحدث 12 عرضاً فقط لتخفيف الحمل
    for (const job of toEnrich) {
      try {
        const { data } = await fetchWithRetry(job.link, {}, 1);
        const $ = cheerio.load(data);
        const body = $('article').first().text().replace(/\s+/g, ' ').trim();
        if (body.length > 100) {
          job.desc = body.slice(0, 900); // وصف موسّع
          const dl = extractDeadline(body);
          if (dl) { job.deadline = dl; job.deadlineDate = parseDeadlineDate(dl); } // الأولوية لآخر أجل من صفحة التفاصيل
        }
        await new Promise(r => setTimeout(r, 1000)); // تأدب مع السيرفر
      } catch (e) {
        // نكتفي ببيانات القائمة إن فشلت صفحة التفاصيل
      }
    }
  }
  return out;
}

// ============================================================
//  ANAPEC — استخراج معمّق (عنوان الوظيفة، المرجع، العقد، المدينة، آخر أجل)
// ============================================================
async function scrapeAnapec(headless = false) {
  const url = 'https://www.anapec.org/sigec-app-rv/fr/chercheurs/resultat_recherche/tout:all';
  let html = '';

  // المحاولة 1: HTTP مباشر (مع تجاوز شهادة SSL غير المكتملة)
  try {
    const { data } = await fetchWithRetry(url, { httpsAgent: insecureAgent });
    html = data;
  } catch (e) {
    console.error('[ANAPEC] HTTP:', e.message);
  }

  // المحاولة 2: Chromium بدون واجهة (ضروري — الموقع Angular SPA)
  if ((!html || parseAnapecHTML(html).length === 0) && headless) {
    try {
      const { execSync } = require('child_process');
      const tmp = path.join(TMP_DIR, 'anapec_render.html');
      const chromeBin = process.env.CHROME_BIN || 'chromium-browser';
      const sh = process.env.PREFIX ? process.env.PREFIX + '/bin/sh' : '/bin/sh';
      execSync(`${chromeBin} --headless --disable-gpu --no-sandbox --disable-dev-shm-usage --virtual-time-budget=25000 --dump-dom "${url}" > "${tmp}" 2>/dev/null`, { timeout: 120000, shell: sh });
      html = fs.readFileSync(tmp, 'utf8');
      console.log('[ANAPEC] تم الرندر عبر Chromium');
    } catch (e) {
      console.error('[ANAPEC] headless:', e.message);
    }
  } else if (!html) {
    console.log('[ANAPEC] الموقع يتطلب متصفحاً — فعّل "ANAPEC عبر Chromium" من لوحة التحكم');
  }

  const jobs = html ? parseAnapecHTML(html) : [];
  console.log('[ANAPEC]:', jobs.length, 'عرض');
  return jobs;
}

function parseAnapecHTML(html) {
  const out = [];
  const $ = cheerio.load(html);

  // بطاقات العروض في تطبيق أنابيك — نغطي البنى المحتملة للـ SPA
  const selectors = [
    'a[href*="detail_offre"]', 'a[href*="detail-offre"]', 'a[href*="/offre/"]',
    '.offre-card', '.card-offre', '.result-item', 'mat-card', '.mat-card',
    '[class*="offre"]', 'article'
  ];
  const seen = new Set();

  $(selectors.join(',')).each((_, el) => {
    const $el = $(el);
    const a = $el.is('a') ? $el : $el.find('a[href*="offre"], a[href*="detail"]').first();
    let href = a.attr('href') || '';
    if (href && !href.startsWith('http')) href = 'https://www.anapec.org' + (href.startsWith('/') ? '' : '/') + href;

    const fullText = $el.text().replace(/\s+/g, ' ').trim();
    if (fullText.length < 15) return;

    // عنوان الوظيفة: أول عنوان فرعي أو أول جزء من النص
    let title = ($el.find('h1,h2,h3,h4,h5,.title,.titre,[class*="titre"],[class*="title"]').first().text() || '').trim();
    if (!title) title = fullText.slice(0, 120);
    if (title.length < 5) return;

    // المرجع: أنابيك تستخدم مراجع مثل "Ref: AB123456" أو أرقام طويلة
    const refM = href.match(/(\d{4,})/) || fullText.match(/(?:réf|ref|reference)[:\s]*([A-Z0-9\-]{4,})/i);

    // نوع العقد: CDI / CDD / Anapec / CI / Intérim
    const contractM = fullText.match(/\b(CDI|CDD|CI|CTT|Intérim|Interim|Freelance|Stage|ANAPEC)\b/i);

    // المدينة: أسماء المدن المغربية الشائعة في النص
    const cityM = fullText.match(/\b(Casablanca|Rabat|Marrakech|Fès|Fes|Tanger|Agadir|Meknès|Meknes|Oujda|Kénitra|Kenitra|Tétouan|Tetouan|Salé|Sale|Mohammedia|El Jadida|Nador|Béni Mellal|Beni Mellal|Settat|Khouribga|Essaouira|Laâyoune|Dakhla|Al Hoceima|Errachidia|Ouarzazate|Guelmim|Taroudant|Safi|Berrechid|Sidi Kacem|Sidi Slimane|Larache|Khemisset|Taza|Taourirt|Jerada|Berkane|Figuig|Ifrane|Azrou|Midelt|Tinghir|Zagora|Tan-Tan|Smara|Boujdour|Dcheira|Ait Melloul|Ouazzane|Chefchaouen|Tiflet|Temara|Ain Harrouda|Ain Sebaa|Hay Riad)\b/i);

    // آخر أجل الترشيح
    const deadline = extractDeadline(fullText);

    // معرف فريد ثابت
    const idKey = refM ? refM[1] : (href || title);
    const id = 'anapec_' + Buffer.from(idKey).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
    if (seen.has(id)) return;
    seen.add(id);

    out.push({
      id,
      source: 'أنابيك',
      title,
      desc: fullText.slice(0, 300),
      date: new Date().toISOString().slice(0, 10),
      type: contractM ? contractM[1].toUpperCase() : 'عرض عمل',
      link: href || 'https://www.anapec.org/sigec-app-rv/fr/chercheurs/resultat_recherche/tout:all',
      deadline,
      deadlineDate: parseDeadlineDate(deadline),
      employer: extractEmployer(title),
      city: cityM ? cityM[1] : '',
      contract: contractM ? contractM[1].toUpperCase() : ''
    });
  });

  return out.slice(0, 30);
}

// ---------------- نقطة الدخول ----------------
async function scanAll(config) {
  let all = [];
  if (config.sources.alwadifa) all = all.concat(await scrapeAlwadifa(2, true));
  if (config.sources.anapec) all = all.concat(await scrapeAnapec(config.anapecHeadless));

  // فلترة بالكلمات المفتاحية إن وُجدت
  const kws = (config.keywords || '').split(/[,،]/).map(s => s.trim()).filter(Boolean);
  if (kws.length) {
    all = all.filter(j => kws.some(k => (j.title + ' ' + j.desc + ' ' + (j.city || '')).toLowerCase().includes(k.toLowerCase())));
  }
  return all;
}

module.exports = { scanAll, scrapeAlwadifa, scrapeAnapec, extractDeadline, parseDeadlineDate };
