// ============================================================
//  scraper.js v3 — Deep job extraction with human-like behavior
//  Logs are in English (Termux has no Arabic font support)
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const path = require('path');
const fs = require('fs');

// -------- Human-like behavior: rotating user agents + random delays --------
const USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36'
];
const randUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Random pause between 2 and 7 seconds — like a human browsing
const humanPause = () => sleep(2000 + Math.floor(Math.random() * 5000));

// Some Moroccan sites have incomplete SSL chains — bypass verification for them only
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Termux-compatible temp dir
const TMP_DIR = process.env.TMPDIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Fetch with automatic retry + human-like headers
async function fetchWithRetry(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, {
        headers: {
          'User-Agent': randUA(),
          'Accept-Language': 'ar,fr;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache'
        },
        timeout: 30000,
        ...opts
      });
    } catch (e) {
      if (i === retries) throw e;
      await sleep(3000 + Math.floor(Math.random() * 3000));
    }
  }
}

// ---------------- Deadline extraction (Arabic + French) ----------------
const AR_MONTHS = 'يناير|فبراير|مارس|أبريل|ابريل|ماي|مايو|يونيو|يونيه|يوليوز|يوليو|غشت|أغسطس|شتنبر|سبتمبر|أكتوبر|اكتوبر|نونبر|نوفمبر|دجنبر|ديسمبر';
const FR_MONTHS = 'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre';

function extractDeadline(text) {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ');
  let m = t.match(new RegExp(`آخر أجل[^0-9]{0,40}?([0-9]{1,2}\\s+(?:${AR_MONTHS})\\s+[0-9]{4})`, 'i'));
  if (m) return m[1];
  m = t.match(new RegExp(`(?:date\\s*limite|avant\\s*le|deadline)[^0-9]{0,30}?([0-9]{1,2}(?:\\s+(?:${FR_MONTHS})\\s+|\\/|-)[0-9]{1,4}(?:\\s*[0-9]{2,4})?)`, 'i'));
  if (m) return m[1];
  m = t.match(/آخر أجل[^0-9]{0,30}?([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/);
  if (m) return m[1];
  return '';
}

function extractEmployer(title) {
  const m = (title || '').match(/^([^:：]{3,60})[:：]/);
  return m ? m[1].trim() : '';
}

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
  let m = dl.match(new RegExp(`([0-9]{1,2})\\s+(${AR_MONTHS})\\s+([0-9]{4})`));
  if (m) return new Date(+m[3], AR_MONTH_MAP[m[2]], +m[1], 23, 59).toISOString();
  m = dl.match(new RegExp(`([0-9]{1,2})\\s+(${FR_MONTHS})\\s+([0-9]{4})`, 'i'));
  if (m) return new Date(+m[3], FR_MONTH_MAP[m[2].toLowerCase()], +m[1], 23, 59).toISOString();
  m = dl.match(/([0-9]{1,2})[\/\-.]([0-9]{1,2})[\/\-.]([0-9]{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[2] - 1, +m[1], 23, 59).toISOString();
  }
  return null;
}

// ---------------- Sector detection: public vs private ----------------
const PUBLIC_KEYWORDS = /مباراة|مباريات|توظيف|جماعة|جماعات|وزارة|المكتب|الوكالة|الجماعات الترابية|concours|commune|minist[eè]re|[eé]tablissement public|collectivit[eé]|wilaya|pr[eé]fecture|province|centre hospitalier|universit[eé]/i;

function detectSector(job) {
  const text = `${job.title} ${job.type} ${job.employer} ${job.desc}`.toLowerCase();
  if (PUBLIC_KEYWORDS.test(text)) return 'public';      // 🟦 public sector
  if (job.source === 'أنابيك') return 'private';        // ANAPEC = mostly private sector
  return 'private';                                      // 🟪 default: private
}

// ============================================================
//  Alwadifa-Maroc.com — listing pages + detail enrichment
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
          const dl = extractDeadline(title + ' ' + desc);
          out.push({
            id: 'alwadifa_' + numId,
            source: 'الوظيفة ماروك',
            title, desc, date, type, link,
            deadline: dl,
            deadlineDate: parseDeadlineDate(dl),
            employer: extractEmployer(title),
            city: '',
            contract: '',
            sector: ''
          });
        }
      });
      console.log(`[Alwadifa] page ${p}: ${out.length} jobs so far`);
      if (p < pages) await humanPause(); // human-like pause between pages
    } catch (e) {
      console.error('[Alwadifa] page', p, 'error:', e.message);
    }
  }

  // Enrich the newest offers by opening detail pages (full desc + exact deadline)
  if (enrichDetails) {
    const toEnrich = out.slice(0, 10);
    for (const job of toEnrich) {
      try {
        const { data } = await fetchWithRetry(job.link, {}, 1);
        const $ = cheerio.load(data);
        const body = $('article').first().text().replace(/\s+/g, ' ').trim();
        if (body.length > 100) {
          job.desc = body.slice(0, 900);
          const dl = extractDeadline(body);
          if (dl) { job.deadline = dl; job.deadlineDate = parseDeadlineDate(dl); }
        }
        await humanPause(); // behave like a human reading each offer
      } catch (e) { /* keep listing data */ }
    }
  }
  out.forEach(j => { j.sector = detectSector(j); });
  return out;
}

// ============================================================
//  ANAPEC — Angular SPA, needs headless Chromium on Termux
// ============================================================
function findChromium() {
  const { execSync } = require('child_process');
  const sh = process.env.PREFIX ? process.env.PREFIX + '/bin/sh' : '/bin/sh';
  for (const bin of ['chromium-browser', 'chromium', 'google-chrome']) {
    try {
      const p = execSync(`command -v ${bin}`, { shell: sh, timeout: 5000 }).toString().trim();
      if (p) return p;
    } catch (e) { /* try next */ }
  }
  return null;
}

async function scrapeAnapec(headless = false) {
  const url = 'https://www.anapec.org/sigec-app-rv/fr/chercheurs/resultat_recherche/tout:all';
  let html = '';

  // Attempt 1: plain HTTP (bypass broken SSL chain)
  try {
    const { data } = await fetchWithRetry(url, { httpsAgent: insecureAgent });
    html = data;
  } catch (e) {
    console.error('[ANAPEC] HTTP error:', e.message);
  }

  // If HTTP gave us the raw listing, no need for a browser
  if (html && parseAnapecHTML(html).length > 0) {
    const jobs = parseAnapecHTML(html);
    console.log('[ANAPEC] HTTP parse OK:', jobs.length, 'jobs');
    return jobs;
  }

  // Attempt 2: headless Chromium (the site is an Angular SPA)
  if (!headless) {
    console.log('[ANAPEC] site requires a browser — enable "ANAPEC via Chromium" in the dashboard');
    return [];
  }
  const chrome = process.env.CHROME_BIN || findChromium();
  if (!chrome) {
    console.log('[ANAPEC] Chromium not found — run: pkg install x11-repo -y && pkg install chromium -y');
    return [];
  }
  try {
    const { execSync } = require('child_process');
    const tmp = path.join(TMP_DIR, 'anapec_render.html');
    const sh = process.env.PREFIX ? process.env.PREFIX + '/bin/sh' : '/bin/sh';
    // Hard 90s shell timeout so a hung browser can never block the bot
    execSync(
      `timeout 90 "${chrome}" --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage --disable-extensions --virtual-time-budget=15000 --dump-dom "${url}" > "${tmp}" 2>/dev/null`,
      { timeout: 100000, shell: sh }
    );
    html = fs.existsSync(tmp) ? fs.readFileSync(tmp, 'utf8') : '';
    console.log('[ANAPEC] Chromium render done, HTML size:', html.length);
  } catch (e) {
    console.error('[ANAPEC] headless error:', e.message);
    return [];
  }

  const jobs = html ? parseAnapecHTML(html) : [];
  console.log('[ANAPEC]:', jobs.length, 'jobs');
  return jobs;
}

function parseAnapecHTML(html) {
  const out = [];
  const $ = cheerio.load(html);

  const selectors = [
    'a[href*="detail_offre"]', 'a[href*="detail-offre"]', 'a[href*="/offre"]',
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

    // Job title: heading, or first line, or text before the reference number
    let title = ($el.find('h1,h2,h3,h4,h5,.title,.titre,[class*="titre"],[class*="title"],strong,b').first().text() || '').trim();
    if (!title) {
      // ANAPEC cards often read: "JOB TITLE Réf: XXX CDI Casablanca" — cut at the ref/contract
      title = fullText.split(/\s+(?:réf|ref|CDI|CDD|CI)\b/i)[0].trim();
    }
    if (!title) title = fullText.slice(0, 120);
    title = title.slice(0, 150);
    if (title.length < 5) return;

    const refM = href.match(/(\d{4,})/) || fullText.match(/(?:réf|ref|reference)[:\s]*([A-Z0-9\-]{4,})/i);
    const contractM = fullText.match(/\b(CDI|CDD|CI|CTT|Intérim|Interim|Freelance|Stage)\b/i);
    const cityM = fullText.match(/\b(Casablanca|Rabat|Marrakech|Fès|Fes|Tanger|Agadir|Meknès|Meknes|Oujda|Kénitra|Kenitra|Tétouan|Tetouan|Salé|Sale|Mohammedia|El Jadida|Nador|Béni Mellal|Beni Mellal|Settat|Khouribga|Essaouira|Laâyoune|Dakhla|Al Hoceima|Errachidia|Ouarzazate|Guelmim|Taroudant|Safi|Berrechid|Sidi Kacem|Larache|Khemisset|Taza|Berkane|Ifrane|Temara|Ain Sebaa)\b/i);
    const deadline = extractDeadline(fullText);

    const idKey = refM ? refM[1] : (href || title);
    const id = 'anapec_' + Buffer.from(idKey).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
    if (seen.has(id)) return;
    seen.add(id);

    const job = {
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
      contract: contractM ? contractM[1].toUpperCase() : '',
      sector: ''
    };
    job.sector = detectSector(job);
    out.push(job);
  });

  return out.slice(0, 30);
}

// ---------------- Entry point ----------------
async function scanAll(config) {
  let all = [];
  if (config.sources.alwadifa) {
    all = all.concat(await scrapeAlwadifa(2, true));
  }
  if (config.sources.anapec) {
    await humanPause(); // pause between the two sites — like a human switching tabs
    all = all.concat(await scrapeAnapec(config.anapecHeadless));
  }

  const kws = (config.keywords || '').split(/[,،]/).map(s => s.trim()).filter(Boolean);
  if (kws.length) {
    all = all.filter(j => kws.some(k => (j.title + ' ' + j.desc + ' ' + (j.city || '')).toLowerCase().includes(k.toLowerCase())));
  }
  return all;
}

module.exports = { scanAll, scrapeAlwadifa, scrapeAnapec, extractDeadline, parseDeadlineDate, detectSector };
