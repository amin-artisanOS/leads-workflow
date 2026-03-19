const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function scrape() {
  const searchUrl = process.env.LINKEDIN_SEARCH_URL;
  const maxResults = parseInt(process.env.MAX_RESULTS || '100', 10);
  const debug = String(process.env.DEBUG_LOG).toLowerCase() === 'true';

  if (!searchUrl) {
    throw new Error('LINKEDIN_SEARCH_URL is required');
  }

  if (debug) {
    console.log('Launching browser...');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // LinkedIn blocks aggressively; set a realistic UA
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  const jobs = [];

  async function handleSearchPage() {
    await page.goto(searchUrl, { waitUntil: 'networkidle' });

    // Wait for results list
    await page.waitForSelector('.jobs-search__results-list, ul.jobs-search__results-list', {
      timeout: 30000,
    });

    let pageNum = 1;
    while (jobs.length < maxResults) {
      if (debug) console.log(`Collecting links on search page ${pageNum}...`);

      // Ensure list is present
      const links = await page.$$eval('a[href*="/jobs/view/"]', (as) => {
        const dedup = new Set();
        for (const a of as) {
          const href = a.getAttribute('href') || '';
          if (href.includes('/jobs/view/')) dedup.add(href.split('?')[0]);
        }
        return Array.from(dedup);
      });

      // Visit each job until we reach the cap
      for (const rawUrl of links) {
        if (jobs.length >= maxResults) break;
        const jobUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.linkedin.com${rawUrl}`;
        try {
          const data = await handleJobPage(jobUrl);
          if (data) {
            jobs.push(data);
            if (debug) console.log(`Scraped [${jobs.length}/${maxResults}] ${data.title} @ ${data.companyName}`);
          }
        } catch (e) {
          if (debug) console.warn('Job page error:', e.message);
        }
        await delay(500 + Math.random() * 500);
      }

      if (jobs.length >= maxResults) break;

      // Try to go to next page (public jobs pagination button)
      const nextButton = await page.$('button[aria-label*="Next" i]:not([disabled])');
      if (nextButton) {
        await nextButton.click();
        await page.waitForLoadState('networkidle');
        pageNum += 1;
        await delay(1000);
      } else {
        break; // no more pages
      }
    }
  }

  async function handleJobPage(jobUrl) {
    const p = await context.newPage();
    try {
      await p.goto(jobUrl, { waitUntil: 'networkidle', timeout: 60000 });
      await p.waitForSelector('.top-card-layout__title, h1.top-card-layout__title', { timeout: 20000 });

      const data = await p.evaluate(() => {
        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
        const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
        const title = getText('.top-card-layout__title, h1.top-card-layout__title');
        const companyName =
          getText('a.topcard__org-name-link, a.topcard__flavor--black-link, span.topcard__flavor');
        const location = getText('.topcard__flavor--bullet, .topcard__flavor');
        const companyLinkedinUrl = getAttr('a.topcard__org-name-link, a.topcard__flavor--black-link', 'href');
        const companyLogo = getAttr('img.topcard__org-image-logo', 'src');
        const postedAt = getText('.posted-time-ago__text');
        const applicantsCount = getText('.num-applicants__caption');
        const descriptionEl = document.querySelector('.show-more-less-html__markup');
        const descriptionHtml = descriptionEl ? descriptionEl.innerHTML : '';
        const descriptionText = descriptionEl ? (descriptionEl.textContent || '').trim() : '';
        const applyUrl = getAttr('a[href*="/jobs/apply/"]', 'href') || getAttr('a.apply-button', 'href');

        // Criteria (seniority level, employment type, etc.)
        const criteria = {};
        document.querySelectorAll('.description__job-criteria-item').forEach((item) => {
          const key = item
            .querySelector('.description__job-criteria-subheader')
            ?.textContent?.trim()
            ?.toLowerCase();
          const value = item
            .querySelector('.description__job-criteria-text--criteria')
            ?.textContent?.trim();
          if (key && value) criteria[key] = value;
        });

        const id = (new URL(location.href).pathname.split('/').filter(Boolean).pop() || '').split('?')[0];

        return {
          id,
          link: location.href,
          title,
          companyName,
          companyLinkedinUrl,
          companyLogo,
          location,
          salaryInfo: [],
          postedAt,
          benefits: [],
          descriptionHtml,
          descriptionText,
          applicantsCount,
          applyUrl,
          ...criteria,
          scrapedAt: new Date().toISOString(),
        };
      });

      return data;
    } finally {
      await p.close();
    }
  }

  try {
    await handleSearchPage();
  } finally {
    await context.close();
    await browser.close();
  }

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `jobs_${nowIso()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(jobs, null, 2));
  console.log(`Saved ${jobs.length} jobs to ${outPath}`);
}

scrape().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
