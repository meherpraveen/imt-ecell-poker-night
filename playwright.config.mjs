import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',testMatch:'**/*.spec.mjs',fullyParallel:true,workers:2,timeout:60000,
  reporter:'list',outputDir:'.local/browser-results',
  use:{browserName:'chromium',channel:process.env.POKER_BROWSER_CHANNEL||undefined,viewport:{width:390,height:844},locale:'en-IN',timezoneId:'Asia/Kolkata'}
});
