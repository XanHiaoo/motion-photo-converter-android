// Optional end-to-end smoke test: NODE_PATH=<playwright-core modules> node tests/fade-smoke.cjs <video.mp4>
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

(async () => {
  const source = process.argv[2];
  if (!source) throw new Error('Provide a local H.264 MP4 sample path.');
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.on('pageerror', (error) => process.stderr.write(`PAGE ERROR: ${error.message}\n`));
    await page.goto('http://127.0.0.1:5175/samsung-motion-photo-converter/');
    await page.getByRole('button', { name: /视频生成动态图/ }).click();
    await page.locator('input[type=file]').setInputFiles(source);
    await page.waitForFunction(() => Number.isFinite(document.querySelector('video')?.duration));
    if (process.argv.includes('--trim')) {
      const start = page.getByRole('slider', { name: '片段起点' });
      const end = page.getByRole('slider', { name: '片段终点' });
      await start.focus();
      for (let i = 0; i < 10; i++) await start.press('ArrowRight');
      await end.focus();
      for (let i = 0; i < 10; i++) await end.press('ArrowLeft');
      if (process.argv.includes('--precise')) await page.getByRole('button', { name: '精确裁剪' }).click();
    }
    await page.evaluate(() => {
      window.__fadeStages = [];
      new MutationObserver(() => {
        const stage = document.querySelector('.progress-copy strong')?.textContent;
        if (stage && window.__fadeStages.at(-1) !== stage) window.__fadeStages.push(stage);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const started = Date.now();
    await page.getByRole('button', { name: '生成 Motion Photo' }).click();
    await Promise.race([
      page.locator('.result-card').waitFor({ timeout: 180000 }),
      page.locator('.error-card').waitFor({ timeout: 180000 }).then(async () => {
        throw new Error(await page.locator('.error-card').innerText());
      }),
    ]);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /保存 Motion Photo/ }).click();
    const download = await downloadPromise;
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-fade-'));
    const output = path.join(outputDir, 'output.jpg');
    await download.saveAs(output);
    const motion = fs.readFileSync(output);
    const ftyp = motion.indexOf(Buffer.from('ftyp'));
    if (ftyp < 4) throw new Error('Output does not contain an MP4 segment.');
    const mp4 = path.join(outputDir, 'video.mp4');
    fs.writeFileSync(mp4, motion.subarray(ftyp - 4));
    if (process.env.FFMPEG_EXE) {
      execFileSync(process.env.FFMPEG_EXE, ['-v', 'error', '-xerror', '-i', mp4, '-f', 'null', 'NUL']);
    }
    const stages = await page.evaluate(() => window.__fadeStages);
    process.stdout.write(JSON.stringify({ seconds: (Date.now() - started) / 1000, output, mp4, stages }) + '\n');
  } finally {
    await browser.close();
  }
})().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
