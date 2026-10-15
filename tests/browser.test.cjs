/* Run against a local static server: BASE_URL=http://127.0.0.1:8765 node tests/browser.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8765';
const root = path.resolve(__dirname, '..');
const review = path.join(root, 'review');
fs.mkdirSync(review, {recursive:true});
const results = [];
function pass(name,detail){results.push({name,status:'passed',detail});console.log('PASS',name,detail||'')}
const fakeSDK = `
var Decart = (() => {
 window.__connections = [];
 window.__delayConnect = false;
 return {
 models: {realtime: name => ({name,fps:30,width:1280,height:720})},
 createDecartClient: () => ({realtime:{connect: async (input,opts) => {
  let handlers={};const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d');let timer=setInterval(()=>{ctx.fillStyle='#255fdb';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#ffffff';ctx.font='50px sans-serif';ctx.fillText('REMOTE OUTPUT',300,380)},30);
  const stream=canvas.captureStream(30);
  const session={input,opts,disconnected:false,updates:[],emit:(name,data)=>(handlers[name]||[]).forEach(fn=>fn(data)),
   on:(name,fn)=>{(handlers[name] ||= []).push(fn)},
   set:async state=>{session.updates.push(state)},
   isConnected:()=>!session.disconnected,
   disconnect:()=>{session.disconnected=true;clearInterval(timer);stream.getTracks().forEach(t=>t.stop())}};
  window.__connections.push(session);
  opts.onRemoteStream(stream);
  if(window.__delayConnect)await new Promise(resolve=>session.finish=resolve);
  return session;
 }}})
 };
})();`;
async function waitForGallery(page,count){await page.waitForFunction(n=>document.getElementById('galleryCount').textContent===String(n),count)}
async function closeDialog(page,id){await page.locator('#'+id+' [data-close]').click()}
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['camera'],acceptDownloads:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL);await page.waitForFunction(()=>document.querySelectorAll('.garment-card').length===6);
  assert.equal(await page.title(),'MIRRA 试穿间 · 你的下一种风格');
  await page.screenshot({path:path.join(review,'desktop.png'),fullPage:true});
  pass('real SDK loads with six supplied assets');
  for(const [width,height] of [[320,740],[375,812],[390,844],[768,1024],[1024,768],[1440,1000],[844,390]]){
   await page.setViewportSize({width,height});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert.equal(overflow,false,`horizontal overflow at ${width}`);
   if(width<768&&height>500){const y=await page.locator('#uploadDrop').evaluate(el=>el.getBoundingClientRect().top);assert.ok(y<400,'upload entry is near top')}
   pass('responsive '+width+'×'+height);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(review,'mobile.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#emptyCamera').click();await page.waitForFunction(()=>document.getElementById('cameraVideo').videoWidth>0);
  await page.locator('#captureSettings').click();await page.locator('#captureRatio').selectOption('square');await closeDialog(page,'settingsDialog');
  const automaticPhoto=page.waitForEvent('download');await page.locator('#snapshotButton').click();await waitForGallery(page,1);assert.match((await automaticPhoto).suggestedFilename(),/\.png$/);pass('photo automatically starts a local download');
  await page.locator('#recentGallery .media-card').first().click();
  assert.match(await page.locator('#mediaMeta').textContent(),/720 × 720/);
  const photoEvent=page.waitForEvent('download');await page.locator('#downloadMedia').click();const photo=await photoEvent;await photo.saveAs(path.join(review,'capture-test.png'));assert.match(photo.suggestedFilename(),/\.png$/);await closeDialog(page,'mediaDialog');
  pass('square screenshot, IndexedDB save and PNG download');
  await page.locator('#recordButton').click();await page.waitForFunction(()=>!document.getElementById('recordingBadge').hidden);await page.waitForTimeout(1600);const automaticVideo=page.waitForEvent('download');await page.locator('#recordButton').click();await waitForGallery(page,2);assert.match((await automaticVideo).suggestedFilename(),/\.(mp4|webm)$/);pass('recording automatically starts a local download');
  await page.locator('#recentGallery .media-card').first().click();await page.waitForFunction(()=>document.querySelector('#mediaPreview video')?.readyState>=1);
  const meta=await page.locator('#mediaMeta').textContent();assert.match(meta,/MP4|WEBM/);
  const videoEvent=page.waitForEvent('download');await page.locator('#downloadMedia').click();const video=await videoEvent;const videoFilename=video.suggestedFilename();await video.saveAs(path.join(review,'recording-test.'+videoFilename.split('.').pop()));await closeDialog(page,'mediaDialog');
  pass('canvas video recording, playable preview and video download',meta);
  await page.reload();await waitForGallery(page,2);pass('photo and video persist after reload');
  await page.locator('#recentGallery .media-card').first().click();await page.locator('#deleteMedia').click();await page.locator('#confirmDelete').click();await waitForGallery(page,1);pass('confirmed deletion removes persistent media');
  await page.locator('[aria-label="收藏 蜘蛛侠"]').click();await page.locator('[data-category="favorites"]').click();assert.equal(await page.locator('.garment-card').count(),1);await page.locator('[data-category="all"]').click();
  await page.locator('#uploadFile').setInputFiles(path.join(root,'assets','denim.jpg'));await page.waitForFunction(()=>document.querySelectorAll('.garment-card').length===7);assert.equal(await page.locator('#selectedName').textContent(),'denim');pass('favorites filter and custom image import');
  await page.locator('#footerHelp').click();assert.equal(await page.locator('#helpDialog').evaluate(d=>d.open),true);await closeDialog(page,'helpDialog');pass('mobile help is accessible');
  await page.locator('#emptyCamera').click();await page.waitForFunction(()=>document.getElementById('cameraVideo').videoWidth>0);await page.locator('#cameraButton').click();pass('camera opens and releases tracks');
  assert.deepEqual(errors,[]);pass('no browser runtime errors with bundled real SDK');
  await context.close();

  const mocked=await browser.newContext({viewport:{width:1440,height:1000},permissions:['camera'],acceptDownloads:true});
  const app=await mocked.newPage();const mockedErrors=[];app.on('pageerror',e=>mockedErrors.push(e.message));
  await app.route('**/vendor/decart-sdk-0.2.11.js',route=>route.fulfill({contentType:'application/javascript',body:fakeSDK}));
  let quotaRequests=0;await app.route('https://api.decart.ai/v1/realtime/quota',route=>{quotaRequests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({limit:null,active:null,remaining:null})})});
  await app.goto(baseURL);await app.locator('#openKey').click();await app.locator('#keyInput').fill('local-test-key');await app.locator('#saveKey').click();await app.waitForFunction(()=>document.getElementById('keyResult').textContent.includes('验证成功'));
  assert.match(await app.locator('#keyResult').textContent(),/不代表积分余额/);assert.equal(await app.evaluate(()=>localStorage.getItem('decart_key')),null);assert.equal(await app.evaluate(()=>sessionStorage.getItem('mirra_session_key')),'local-test-key');assert.equal(quotaRequests,1);await closeDialog(app,'keyDialog');pass('Key validation and session-only storage by default');
  await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===1&&document.getElementById('viewerStatus').textContent.includes('AI 试穿中'));
  await app.waitForFunction(()=>!document.getElementById('compareButton').disabled);
  await app.evaluate(()=>{window.__connections[0].emit('stats',{video:{framesPerSecond:29.7},connection:{currentRoundTripTime:.052}});window.__connections[0].emit('generationTick',{seconds:5})});
  assert.equal(await app.locator('#metricRtt').textContent(),'52 ms');assert.equal(await app.locator('#metricFps').textContent(),'29.7 fps');assert.equal(await app.locator('#sessionCost').textContent(),'$0.10');
  pass('realtime first frame, SDK RTT fields and server billing ticks');
  await app.locator('#compareButton').click();assert.equal(await app.locator('#compareRange').isVisible(),true);
  await app.locator('#snapshotButton').click();await waitForGallery(app,1);await app.locator('#recentGallery .media-card').first().click();
  const colors=await app.locator('#mediaPreview img').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {left:[...x.getImageData(100,100,1,1).data],right:[...x.getImageData(c.width-100,100,1,1).data]}});
  assert.ok(colors.right[2]>180&&colors.right[0]<80,'right half exports remote blue output');assert.notDeepEqual(colors.left,colors.right,'left half exports original input');await closeDialog(app,'mediaDialog');pass('comparison export uses original and remote video pixels');
  await app.locator('.prompt-details').evaluate(d=>d.open=true);await app.locator('#prompt').fill('A navy blue tailored jacket');await app.locator('#applyPrompt').click();await app.waitForFunction(()=>window.__connections[0].updates.length>=1);assert.equal(await app.evaluate(()=>window.__connections[0].updates.at(-1).prompt),'A navy blue tailored jacket');pass('prompt edits update the live session');
  await app.locator('#tryButton').click();assert.equal(await app.evaluate(()=>window.__connections[0].disconnected),true);assert.equal(await app.locator('#cameraVideo').evaluate(v=>v.srcObject.getVideoTracks()[0].readyState),'live');pass('stop disconnects AI while preserving camera preview');
  await app.evaluate(()=>window.__delayConnect=true);await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===2);await app.locator('#tryButton').click();await app.evaluate(()=>window.__connections[1].finish());await app.waitForFunction(()=>window.__connections[1].disconnected);
  assert.equal(await app.locator('#viewerStatus').textContent(),'摄像头已开启');assert.match(await app.locator('#tryButton').textContent(),/开始 AI 试穿/);pass('late connection is disposed after cancellation');
  await app.evaluate(()=>window.__delayConnect=false);await app.locator('[data-speed="fast"]').click();await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===3);assert.equal(await app.evaluate(()=>window.__connections[2].opts.speed),'fast');
  await app.locator('#modelSelect').selectOption('lucy-restyle-latest');await app.waitForFunction(()=>window.__connections.length===4);assert.equal(await app.evaluate(()=>window.__connections[2].disconnected),true);assert.equal(await app.evaluate(()=>window.__connections[3].opts.speed),undefined);assert.equal(await app.locator('#priceLabel').textContent(),'$0.01 / 秒');assert.equal(await app.locator('[data-speed="fast"]').isDisabled(),true);pass('model and speed changes reconnect with correct pricing');
  await app.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await app.waitForFunction(()=>window.__connections[3].disconnected);pass('background transition stops chargeable session');
  await app.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));window.__delayConnect=true});
  await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===5);
  await app.locator('[aria-label="选择 牛仔"]').click();await app.locator('#prompt').fill('A denim cowboy outfit');
  await app.evaluate(()=>window.__connections[4].finish());await app.waitForFunction(()=>window.__connections[4].updates.length>=1);
  assert.equal(await app.evaluate(()=>window.__connections[4].updates.at(-1).prompt),'A denim cowboy outfit');await app.locator('#tryButton').click();pass('reference and prompt changes during connect are applied after connection');
  await app.clock.install();await app.evaluate(()=>window.__delayConnect=false);
  await app.locator('#openSettings').click();await app.locator('#sessionLimit').selectOption('60');await closeDialog(app,'settingsDialog');
  await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===6&&document.getElementById('viewerStatus').textContent.includes('AI 试穿中'));await app.clock.fastForward(61000);await app.waitForFunction(()=>window.__connections[5].disconnected);pass('configured session duration limit stops the session');
  await app.locator('#openSettings').click();await app.locator('#sessionLimit').selectOption('180');await closeDialog(app,'settingsDialog');
  await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===7&&document.getElementById('viewerStatus').textContent.includes('AI 试穿中'));await app.clock.fastForward(61000);await app.waitForFunction(()=>window.__connections[6].disconnected);pass('idle watchdog stops the session after 60 seconds');
  await app.evaluate(()=>window.__delayConnect=true);await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===8);await app.clock.fastForward(46000);await app.evaluate(()=>window.__connections[7].finish());await app.waitForFunction(()=>window.__connections[7].disconnected);pass('connection timeout also disposes late SDK resolution');
  await app.evaluate(()=>window.__delayConnect=false);await app.locator('#tryButton').click();await app.waitForFunction(()=>window.__connections.length===9&&document.getElementById('viewerStatus').textContent.includes('AI 试穿中'));await app.locator('.top-nav [data-view="gallery"]').click();await app.waitForFunction(()=>window.__connections[8].disconnected);assert.equal(await app.locator('#galleryView').isVisible(),true);pass('opening the gallery stops the active paid session');
  assert.deepEqual(mockedErrors,[]);await mocked.close();pass('no browser runtime errors in connection lifecycle tests');
  const report={testedAt:new Date().toISOString(),browser:'Google Chrome headless',results,notes:['Camera and recording use a browser test video source.','Decart generation is mocked; no paid generation was requested.','Real Key checks were limited to authenticated quota and file-list queries.']};
  fs.writeFileSync(path.join(review,'test-results.json'),JSON.stringify(report,null,2));console.log('TOTAL',results.length,'PASSED');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
