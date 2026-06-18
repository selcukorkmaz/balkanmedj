const puppeteer=require('puppeteer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  await p.goto('http://localhost:3099/#/pages/for-reviewers',{waitUntil:'networkidle0'});
  await sleep(700);
  const fh=await p.$('#pg-frame'); const frame=await fh.contentFrame();
  await frame.waitForSelector('[data-ce="1"]',{timeout:6000}).catch(()=>{});
  await sleep(300);
  await p.evaluate(()=>saveVisualPage('for-reviewers')); // NO edits
  await sleep(800);
  await b.close();
})().catch(e=>{console.error(e);process.exit(2);});
