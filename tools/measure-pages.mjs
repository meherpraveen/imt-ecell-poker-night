import {readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';

const domain = readFileSync(new URL('../docs/CNAME', import.meta.url), 'utf8').trim();
const site = process.env.POKER_PUBLIC_SITE || 'https://' + domain + '/';
const routes = [
  ['home', './', '[data-home-fee="entry"]'],
  ['registration', 'event.html?view=register', '.offer .price-values strong'],
  ['floor', 'event.html?view=board', '#clock']
];
const browser = await chromium.launch({channel: process.env.POKER_BROWSER_CHANNEL || undefined});
const samples = [];
try {
  // Three independent cold visits per route. Each context has empty HTTP and device caches.
  for (let run = 1; run <= 3; run++) {
    for (const [route, path, readySelector] of routes) {
      const context = await browser.newContext({
        viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        locale: 'en-IN', timezoneId: 'Asia/Kolkata'
      });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency: 150, downloadThroughput: 1600000 / 8, uploadThroughput: 750000 / 8
        });
        await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
        await page.addInitScript(() => {
          let firstShift = 0, lastShift = 0, windowScore = 0;
          window.pageMetrics = {lcpMs: 0, cls: 0};
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.pageMetrics.lcpMs = Math.round(entry.startTime);
          }).observe({type: 'largest-contentful-paint', buffered: true});
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (entry.hadRecentInput) continue;
              if (entry.startTime - lastShift >= 1000 || entry.startTime - firstShift >= 5000 || !windowScore) {
                firstShift = entry.startTime;
                windowScore = 0;
              }
              lastShift = entry.startTime;
              windowScore += entry.value;
              window.pageMetrics.cls = Math.max(window.pageMetrics.cls, windowScore);
            }
          }).observe({type: 'layout-shift', buffered: true});
        });
        const response = await page.goto(new URL(path, site).href, {waitUntil: 'commit'});
        if (!response?.ok()) throw Error('Failed to load ' + route + ' (HTTP ' + response?.status() + ')');
        const ready = await page.waitForFunction(selector => {
          if (document.querySelector('[data-entry-price][data-rendered="schedule"]')) return;
          if (document.querySelector(selector)?.textContent.trim()) return Math.round(performance.now());
        }, readySelector, {timeout: 45000});
        const dataReadyMs = await ready.jsonValue();
        await page.waitForLoadState('load');
        await page.waitForFunction(() => window.pageMetrics.lcpMs > 0);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const metrics = await page.evaluate(() => {
          const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')];
          const bytes = entries.filter(entry => new URL(entry.name).origin === location.origin)
            .reduce((total, entry) => total + entry.encodedBodySize, 0);
          return {...window.pageMetrics, cls: +window.pageMetrics.cls.toFixed(4), siteKiB: Math.round(bytes / 1024)};
        });
        samples.push({route, ...metrics, dataReadyMs});
        console.log('Run', run, route, JSON.stringify({...metrics, dataReadyMs}));
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log('Cold mobile medians (4× CPU, 150 ms latency, 1.6 Mbps down, DPR 2)');
console.table(routes.map(([route]) => {
  const visits = samples.filter(sample => sample.route === route);
  const median = key => visits.map(sample => sample[key]).sort((a, b) => a - b)[1];
  return {route, lcpMs: median('lcpMs'), cls: median('cls'), siteKiB: median('siteKiB'), dataReadyMs: median('dataReadyMs')};
}));
