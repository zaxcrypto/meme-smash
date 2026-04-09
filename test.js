const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    await page.goto('http://127.0.0.1:8765');
    console.log("Typing name...");
    await page.type('#playerName', 'FixTest');
    console.log("Clicking button...");
    await page.click('#btn-start');
    await new Promise(r => setTimeout(r, 1000));
    await browser.close();
})();
