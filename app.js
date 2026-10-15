'use strict';
(() => {
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const API = 'https://api.decart.ai';
const STORAGE = {settings:'mirra_settings_v1', favorites:'mirra_favorites_v1', usage:'mirra_usage_v1', key:'decart_key', sessionKey:'mirra_session_key'};
const prompts = {
 'lucy-vton-latest':'Dress the person in the outfit from the reference image. Preserve the person’s identity, face, body proportions, pose and background. Reproduce the clothing, colors, textures and accessories accurately.',
 'lucy-latest':'Transform the person into the character in the reference image, matching the outfit and overall character appearance. Preserve the original motion, pose and background.',
 'lucy-restyle-latest':'Restyle the entire video to match the visual style, colors and atmosphere of the reference image. Preserve the composition and motion.'
};
const samples = [
 {id:'spider',name:'蜘蛛侠',category:'角色造型',src:'assets/spider.jpg'},
 {id:'wonton',name:'一斤馄饨',category:'角色造型',src:'assets/wonton.jpg'},
 {id:'denim',name:'牛仔',category:'日常穿搭',src:'assets/denim.jpg'},
 {id:'menswear',name:'男士',category:'男士精选',src:'assets/menswear.jpg'},
 {id:'womenswear-1',name:'女士 · Look 01',category:'女士精选',src:'assets/womenswear-1.jpg'},
 {id:'womenswear-2',name:'女士 · Look 02',category:'女士精选',src:'assets/womenswear-2.jpg'}
];
const safeStore = {
 get(k,session=false){try{return (session?sessionStorage:localStorage).getItem(k)}catch{return null}},
 set(k,v,session=false){try{(session?sessionStorage:localStorage).setItem(k,v);return true}catch{return false}},
 remove(k,session=false){try{(session?sessionStorage:localStorage).removeItem(k)}catch{}}
};
function readJSON(key,fallback){try{return JSON.parse(safeStore.get(key))??fallback}catch{return fallback}}
const defaults={captureRatio:'native',photoDelay:0,autoDownload:true,sessionLimit:180,idleStop:true,backgroundStop:true,mirror:{user:true,environment:false}};
const storedSettings=readJSON(STORAGE.settings,{});
const settings={...defaults,...storedSettings,mirror:{...defaults.mirror,...storedSettings.mirror}};
let usage=readJSON(STORAGE.usage,{});
let favorites=new Set(readJSON(STORAGE.favorites,[]));
let key=safeStore.get(STORAGE.key)||safeStore.get(STORAGE.sessionKey,true)||'';
let keyHash='', keyRevision=0, category='all', mediaFilter='all', currentView='studio';
let selected=samples[0], modelName='lucy-vton-latest', speed='standard', cameraStream=null, cameraBusy=false, facing='user';
let current=null, nextId=0, compare=false, recording=null, recordStarting=false, capturing=false, lastActivity=Date.now(), pageClosing=false;
let db=null, gallery=[], objectURLs=new Map(), currentMedia=null, mediaURL=null, referenceRevision=0, promptTimer=null;
let sessionSeconds=0, sessionDollars=0, lastFps=null, lastRtt=null, firstSeconds=null;
const logs=[];
const formatTime = n => `${Math.floor(Math.max(0,n)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,n)%60).toString().padStart(2,'0')}`;
const money = n => '$'+Number(n||0).toFixed(2);
function cleanError(error){return String(error?.message||error||'请稍后重试').replace(/dct_[A-Za-z0-9_-]+/g,'[Key]').replace(/([?&]api_key=)[^&\s]+/g,'$1[Key]').slice(0,350)}
function log(message){logs.unshift(new Date().toLocaleTimeString()+' '+cleanError(message));logs.length=Math.min(logs.length,100);$('diagnostics').textContent=logs.join('\n')}
function toast(message,error=false,action){
 const el=document.createElement('div');el.className='toast'+(error?' error':'');const text=document.createElement('span');text.textContent=message;el.append(text);
 if(action){const b=document.createElement('button');b.textContent=action.label;b.onclick=()=>{action.run();el.remove()};el.append(b)}
 $('toastStack').append(el);setTimeout(()=>el.remove(),action?9500:5000);
}
function showDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal()}
function showView(view){if(view==='gallery'){stopRecording();stopSession('进入作品库，AI 试穿已停止')}currentView=view;$('studioView').hidden=view!=='studio';$('galleryView').hidden=view!=='gallery';$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));renderGallery();window.scrollTo({top:0,behavior:'instant'})}
$$('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$$('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()});d.addEventListener('close',()=>{if(d.id==='mediaDialog'){$('mediaPreview').querySelector('video')?.pause();if(mediaURL){URL.revokeObjectURL(mediaURL);mediaURL=null}$('mediaPreview').replaceChildren();currentMedia=null}})});
$('openHelp').onclick=()=>showDialog('helpDialog');
$('footerHelp').onclick=()=>showDialog('helpDialog');
function openSettings(){updateUsage();showDialog('settingsDialog')}
$('openSettings').onclick=openSettings;$('captureSettings').onclick=openSettings;
$('openKey').onclick=()=>{if(current){toast('请先停止 AI 试穿，再更换 Key');return}$('keyInput').value=key;$('rememberKey').checked=!!safeStore.get(STORAGE.key);showDialog('keyDialog')};
$('toggleKey').onclick=()=>{const shown=$('keyInput').type==='password';$('keyInput').type=shown?'text':'password';$('toggleKey').setAttribute('aria-label',shown?'隐藏 API Key':'显示 API Key')};
async function fingerprint(value){if(!value)return '';const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].slice(0,8).map(v=>v.toString(16).padStart(2,'0')).join('')}
function updateUsage(){$('totalUsage').textContent=money(usage[keyHash]||0)}
function renderKey(valid=null){$('keyLabel').textContent=key?(valid===false?'Key 待检查':'我的 Key 已连接'):'连接你的 API Key';$('keyDot').classList.toggle('on',!!key&&valid!==false)}
async function validateKey(value){
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch(API+'/v1/realtime/quota',{headers:{'x-api-key':value},signal:controller.signal});if(!response.ok){if(response.status===401||response.status===403)throw Error('Key 验证未通过，请检查 Key 或账户权限');throw Error('服务返回 HTTP '+response.status)}return await response.json()}finally{clearTimeout(timeout)}
}
$('keyForm').onsubmit=async e=>{
 e.preventDefault();const value=$('keyInput').value.trim();if(!value){toast('请先输入 API Key',true);return}if(current){toast('请先停止当前 AI 试穿');return}
 const revision=++keyRevision;const result=$('keyResult');result.hidden=false;result.classList.remove('error');result.textContent='正在验证官方连接…';$('saveKey').disabled=true;
 try{
  const quota=await validateKey(value);const hash=await fingerprint(value);if(revision!==keyRevision)return;
  key=value;keyHash=hash;safeStore.remove(STORAGE.key);safeStore.remove(STORAGE.sessionKey,true);
  const remembered=$('rememberKey').checked;const stored=safeStore.set(remembered?STORAGE.key:STORAGE.sessionKey,key,!remembered);
  renderKey(true);updateUsage();result.textContent=quota.limit==null?'验证成功 · 账户未配置并发上限（不代表积分余额）':`验证成功 · 剩余并发 ${quota.remaining??'未知'} / 上限 ${quota.limit}`;
  if(!stored)toast('Key 当前可用，浏览器未允许保存；刷新后需重新输入');
  log('Key 验证成功；并发上限 '+(quota.limit??'未设置'));toast('连接成功，可以开始试穿了');
 }catch(error){if(revision!==keyRevision)return;result.classList.add('error');result.textContent=error.name==='AbortError'?'连接超时，请检查网络后重试':cleanError(error);log('Key 验证失败：'+cleanError(error))}finally{if(revision===keyRevision)$('saveKey').disabled=false}
};
$('clearKey').onclick=()=>{keyRevision++;key='';keyHash='';safeStore.remove(STORAGE.key);safeStore.remove(STORAGE.sessionKey,true);$('keyInput').value='';$('keyResult').hidden=true;$('saveKey').disabled=false;renderKey();updateUsage();toast('当前 Key 已清除')};
$('prompt').value=prompts[modelName];
function renderGarments(){
 $('garmentGrid').replaceChildren();const visible=samples.filter(s=>category==='all'||(category==='favorites'?favorites.has(s.id):s.category===category));
 if(!visible.length){const empty=document.createElement('div');empty.className='garment-empty';empty.textContent='收藏喜欢的灵感，让它们出现在这里。';$('garmentGrid').append(empty)}
 visible.forEach(s=>{
  const card=document.createElement('div');card.className='garment-card';const button=document.createElement('button');button.className='garment-pick';button.type='button';button.setAttribute('aria-pressed',String(selected.id===s.id));button.setAttribute('aria-label','选择 '+s.name);
  const imageWrap=document.createElement('span');imageWrap.className='garment-image';const image=new Image();image.src=s.src;image.alt=s.name;image.loading='lazy';imageWrap.append(image);const check=document.createElement('span');check.className='garment-check';check.innerHTML=icon('check');imageWrap.append(check);
  const caption=document.createElement('span');caption.className='garment-caption';caption.textContent=s.name;button.append(imageWrap,caption);button.onclick=()=>pickGarment(s);
  const favorite=document.createElement('button');favorite.className='favorite-button';favorite.type='button';favorite.innerHTML=icon('heart');favorite.setAttribute('aria-label',(favorites.has(s.id)?'取消收藏 ':'收藏 ')+s.name);favorite.setAttribute('aria-pressed',String(favorites.has(s.id)));favorite.onclick=()=>{favorites.has(s.id)?favorites.delete(s.id):favorites.add(s.id);safeStore.set(STORAGE.favorites,JSON.stringify([...favorites]));renderGarments()};card.append(button,favorite);$('garmentGrid').append(card);
 });$('garmentCount').textContent=String(samples.length);
}
async function pickGarment(sample){selected=sample;$('selectedThumb').src=sample.src;$('selectedName').textContent=sample.name;renderGarments();lastActivity=Date.now();await applyReference(false)}
async function referenceBlob(sample=selected){if(sample.blob)return sample.blob;const response=await fetch(sample.src);if(!response.ok)throw Error('参考图读取失败');return response.blob()}
let referenceQueue=Promise.resolve();
function applyReference(notify=true){
 const revision=++referenceRevision;const session=current;
 if(!session||!session.rt){if(notify)toast('描述已保存，开始试穿时生效');return Promise.resolve()}
 const sample=selected,prompt=$('prompt').value.trim(),enhance=$('enhance').checked;
 referenceQueue=referenceQueue.catch(()=>{}).then(async()=>{
  if(revision!==referenceRevision||current!==session)return;
  try{const image=await referenceBlob(sample);if(revision!==referenceRevision||current!==session)return;await session.rt.set({prompt:prompt||prompts[session.modelName],image,enhance});if(current===session){log('已更新参考图与描述');if(notify)toast('新造型已应用')}}catch(error){if(current===session){toast('造型更新失败：'+cleanError(error),true);log(error)}}
 });return referenceQueue;
}
$('applyPrompt').onclick=()=>applyReference(true);
$('prompt').addEventListener('input',()=>{referenceRevision++;clearTimeout(promptTimer);if(current?.rt)promptTimer=setTimeout(()=>applyReference(false),900)});
$('enhance').onchange=()=>applyReference(false);
$$('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category;$$('[data-category]').forEach(t=>t.classList.toggle('selected',t===b));renderGarments()});
async function normalizeImage(blob){
 if(blob.size>20*1024*1024)throw Error('请选择 20 MB 以内的图片');
 if(!['image/jpeg','image/png','image/webp'].includes(blob.type))throw Error('请选择 JPG、PNG 或 WebP 图片');
 const url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(image,0,0,canvas.width,canvas.height);return await toBlob(canvas,'image/jpeg',.92)}finally{URL.revokeObjectURL(url)}
}
async function importImage(file,name){
 const blob=await normalizeImage(file);const id='custom-'+crypto.randomUUID();const sample={id,name:(name||'我的参考图').replace(/\.[^.]+$/,'').slice(0,30),category:'日常穿搭',blob,src:URL.createObjectURL(blob)};samples.unshift(sample);category='all';$$('[data-category]').forEach(b=>b.classList.toggle('selected',b.dataset.category==='all'));await pickGarment(sample);toast('参考图已加入本次衣橱');
}
$('uploadFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await importImage(file,file.name)}catch(error){toast(cleanError(error),true)}finally{e.target.value=''}};
$('uploadDrop').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===$('uploadDrop')){e.preventDefault();$('uploadFile').click()}});
['dragenter','dragover'].forEach(type=>$('uploadDrop').addEventListener(type,e=>{e.preventDefault();$('uploadDrop').classList.add('dragging')}));
$('uploadDrop').addEventListener('dragleave',()=>$('uploadDrop').classList.remove('dragging'));
$('uploadDrop').addEventListener('drop',async e=>{e.preventDefault();$('uploadDrop').classList.remove('dragging');const file=e.dataTransfer.files[0];if(file)try{await importImage(file,file.name)}catch(error){toast(cleanError(error),true)}});
$('openUrl').onclick=()=>showDialog('urlDialog');
$('urlForm').onsubmit=async e=>{
 e.preventDefault();const button=$('loadUrl');button.disabled=true;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
 try{const url=new URL($('imageUrl').value.trim());if(!['https:','http:'].includes(url.protocol))throw Error('请输入 HTTP 或 HTTPS 图片地址');const response=await fetch(url.href,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('图片读取失败，HTTP '+response.status);await importImage(await response.blob(),'链接灵感');$('urlDialog').close();$('imageUrl').value=''}catch(error){toast(error.name==='AbortError'?'图片读取超时，请尝试上传文件':'链接读取失败：'+cleanError(error),true)}finally{clearTimeout(timeout);button.disabled=false}
};
function mirrored(){return settings.mirror[facing]??facing==='user'}
function applyMirror(){['cameraVideo','outputVideo','compareVideo'].forEach(id=>$(id).classList.toggle('mirrored',mirrored()));$('mirror').setAttribute('aria-pressed',String(mirrored()))}
function setCompare(value){compare=value;const available=!!current?.outputReady;if(!available)compare=false;$('stage').classList.toggle('comparing',compare);$('compareRange').hidden=!compare;$('compareButton').setAttribute('aria-pressed',String(compare))}
$('compareRange').oninput=()=>{const value=$('compareRange').value;$('compareOriginal').style.clipPath=`inset(0 ${100-value}% 0 0)`;$('compareDivider').style.left=value+'%'};
$('compareButton').onclick=()=>setCompare(!compare);
function videoReady(v){return v.readyState>=2&&v.videoWidth>0&&v.videoHeight>0}
function activeVideo(){return current?.outputReady&&videoReady($('outputVideo'))?$('outputVideo'):$('cameraVideo')}
function liveCamera(){return cameraStream?.getVideoTracks().some(t=>t.readyState==='live')}
function renderState(){
 const cam=!!liveCamera(), session=current, busy=!!session;
 $('stage').classList.toggle('camera-on',cam);$('stageBadges').hidden=!cam;
 $('cameraButton').disabled=cameraBusy;$('emptyCamera').disabled=cameraBusy;
 $('cameraButton').innerHTML=icon('camera')+`<span>${cameraBusy?'正在开启…':cam?'关闭摄像头':'打开摄像头'}</span>`;
 $('tryButton').innerHTML=(session?.status==='connecting'?'<span class="spinner"></span>':icon('spark'))+`<span>${busy?(session.status==='connecting'?'取消连接':'停止 AI 试穿'):'开始 AI 试穿'}</span>`+(!busy?icon('arrow'):'');
 $('tryButton').classList.toggle('stopping',busy);$('tryButton').disabled=cameraBusy;
 $('viewerStatus').replaceChildren();const dot=document.createElement('span');dot.className='status-dot'+(session?.status==='connected'?' on':'');$('viewerStatus').append(dot,document.createTextNode(session?(session.status==='connecting'?'正在连接…':session.status==='reconnecting'?'正在重连…':'AI 试穿中'):cam?'摄像头已开启':'等待开启摄像头'));
 $('sessionState').textContent=session?(session.status==='connected'?'实时连接':session.status==='reconnecting'?'网络重连中':'正在连接'):cam?'本地预览':'准备就绪';$('connectionDot').classList.toggle('on',session?.status==='connected');
 const ai=!!session?.outputReady;$('liveLabel').innerHTML='<i></i>'+(ai?'AI LIVE':'本地预览');$('liveLabel').classList.toggle('ai',ai);
 $('stageModel').textContent=(session?.modelName||modelName)==='lucy-vton-latest'?'LUCY VTON 3.6':(session?.modelName||modelName)==='lucy-latest'?'LUCY 2.5':'LUCY RESTYLE 2';
 $('stageNotice').hidden=!session||session.status==='connected';if(session)$('stageNoticeText').textContent=session.status==='reconnecting'?'网络中断，正在尝试重连…':session.queue?'正在排队 · '+session.queue:'正在连接你的试穿间…';
 $('snapshotButton').disabled=!cam||capturing;$('recordButton').disabled=!cam||recordStarting||!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream;$('compareButton').disabled=!ai;
 $('flipCamera').disabled=!cam||cameraBusy||!!recording;$('mirror').disabled=!!recording;$('captureRatio').disabled=!!recording;
 $('outputVideo').classList.toggle('not-visible',!ai);
 if(!ai)setCompare(false);applyMirror();
}
async function openCamera(){
 if(cameraBusy)return false;if(liveCamera())return true;
 if(!navigator.mediaDevices?.getUserMedia){toast('请使用 HTTPS 或本机 localhost 地址打开，并允许摄像头访问',true);return false}
 cameraBusy=true;renderState();
 try{
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});
  if(pageClosing){stream.getTracks().forEach(t=>t.stop());return false}
  cameraStream=stream;const actual=stream.getVideoTracks()[0].getSettings().facingMode;if(actual==='user'||actual==='environment')facing=actual;
  $('cameraVideo').srcObject=stream;$('compareVideo').srcObject=stream;await $('cameraVideo').play().catch(()=>{});$('compareVideo').play().catch(()=>{});
  stream.getVideoTracks()[0].addEventListener('ended',()=>{if(cameraStream===stream){stopSession('摄像头已断开');cameraStream=null;stopRecording();renderState();toast('摄像头已断开，请重新开启',true)}});
  log('摄像头已开启');return true;
 }catch(error){const messages={NotAllowedError:'请在浏览器中允许摄像头权限，再试一次',NotFoundError:'没有找到可用的摄像头',NotReadableError:'摄像头可能被其他应用占用'};toast(messages[error.name]||'摄像头开启失败：'+cleanError(error),true);log(error);return false}finally{cameraBusy=false;renderState()}
}
async function closeCamera(){await stopRecording();await stopSession('摄像头已关闭');if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}['cameraVideo','compareVideo','outputVideo'].forEach(id=>$(id).srcObject=null);renderState()}
$('cameraButton').onclick=()=>liveCamera()?closeCamera():openCamera();$('emptyCamera').onclick=openCamera;
$('flipCamera').onclick=async()=>{if(cameraBusy||recording)return;const restart=!!current;await stopSession('切换摄像头');if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;facing=facing==='user'?'environment':'user';if(await openCamera()){if(restart)await startSession()}};
$('mirror').onclick=()=>{if(recording)return;settings.mirror[facing]=!mirrored();saveSettings();applyMirror()};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('stage').requestFullscreen)await $('stage').requestFullscreen();else if(activeVideo().webkitEnterFullscreen)activeVideo().webkitEnterFullscreen();else toast('请横屏查看更大的画面')}catch(error){toast('全屏未开启：'+cleanError(error),true)}};
function sessionRate(session){return session.modelName==='lucy-restyle-latest'?.01:session.speed==='fast'?.04:.02}
function generatedSeconds(session){if(session.serverSeconds!=null)return session.serverSeconds;return session.firstAt?Math.floor((performance.now()-session.firstAt)/1000):0}
function commitUsage(session,seconds){
 const cost=Math.max(0,seconds)*sessionRate(session);const delta=cost-session.committed;
 if(delta>0&&session.keyHash){usage[session.keyHash]=Math.round(((usage[session.keyHash]||0)+delta)*10000)/10000;session.committed=cost;safeStore.set(STORAGE.usage,JSON.stringify(usage));updateUsage()}
}
function renderMetrics(session=current){
 if(session){sessionSeconds=generatedSeconds(session);sessionDollars=sessionSeconds*sessionRate(session)}
 $('sessionSeconds').textContent=formatTime(sessionSeconds);$('sessionCost').textContent=money(sessionDollars);$('metricFps').textContent=lastFps==null?'— fps':lastFps.toFixed(1)+' fps';$('metricRtt').textContent=lastRtt==null?'— ms':Math.round(lastRtt*1000)+' ms';$('metricFirst').textContent=firstSeconds==null?'首帧 —':'首帧 '+firstSeconds.toFixed(2)+'s';
}
function noteOutputFrame(session){if(current!==session)return;if(!session.firstAt){session.firstAt=performance.now();firstSeconds=(session.firstAt-session.startedAt)/1000;session.outputReady=true;log('收到首帧 '+firstSeconds.toFixed(2)+' 秒');renderState();renderMetrics(session)}}
function watchOutput(session){
 const video=$('outputVideo');
 if(video.requestVideoFrameCallback){const frame=()=>{if(current!==session)return;noteOutputFrame(session);session.frameCallback=video.requestVideoFrameCallback(frame)};session.frameCallback=video.requestVideoFrameCallback(frame)}
 else{const ready=()=>{if(current===session&&videoReady(video))noteOutputFrame(session)};video.addEventListener('loadeddata',ready,{once:true});session.removeReady=()=>video.removeEventListener('loadeddata',ready);ready()}
}
async function startSession(){
 if(current)return;if(!key){$('openKey').click();toast('先连接自己的 Key，再开始 AI 试穿');return}
 if(!liveCamera()&&!await openCamera())return;if(current||!liveCamera())return;
 const session={id:++nextId,keyHash,modelName,speed,refRevision:referenceRevision,startedAt:performance.now(),status:'connecting',firstAt:0,outputReady:false,serverSeconds:null,committed:0,rt:null,input:cameraStream.clone(),cancelled:false};
 current=session;sessionSeconds=0;sessionDollars=0;lastFps=lastRtt=firstSeconds=null;lastActivity=Date.now();renderState();renderMetrics();
 session.timer=setInterval(()=>{
  if(current!==session)return;renderMetrics(session);
  const now=performance.now();if(session.serverSeconds!=null)commitUsage(session,session.serverSeconds);
  if(session.status==='connecting'&&now-session.startedAt>45000)stopSession('连接等待超时，请重试');
  else if(now-session.startedAt>Number(settings.sessionLimit)*1000)stopSession('已达到本次试穿时长上限');
  else if(settings.idleStop&&Date.now()-lastActivity>60000)stopSession('闲置 60 秒，已停止 AI 试穿');
 },500);
 try{
  const image=await referenceBlob();if(current!==session)return;
  const makeOpts=attempt=>({model:Decart.models.realtime(session.modelName),mirror:'auto',initialState:{prompt:{text:$('prompt').value.trim()||prompts[session.modelName],enhance:$('enhance').checked},image},onRemoteStream:stream=>{if(current!==session||session.attempt!==attempt)return;$('outputVideo').srcObject=stream;$('outputVideo').play().catch(error=>log('输出播放：'+cleanError(error)));watchOutput(session)}});
  // SDK 0.2.x: if the signaling socket drops during the initial connect, the SDK starts an internal
  // reconnect (++currentAttempt) and the original connect() promise rejects with "Stale connect attempt".
  // Treat that (and similar transient errors) as retryable instead of ending the session at 0s.
  let rt=null;
  for(let attempt=1;;attempt++){
   session.attempt=attempt;
   if(attempt>1){session.input.getTracks().forEach(t=>t.stop());if(!liveCamera())throw Error('摄像头已断开');session.input=cameraStream.clone();log('连接被 SDK 重置，自动重试第 '+(attempt-1)+' 次');await pause(600*attempt);if(current!==session||session.cancelled)return}
   const client=Decart.createDecartClient({apiKey:key,telemetryEnabled:false});
   const opts=makeOpts(attempt);if(session.speed==='fast'&&session.modelName!=='lucy-restyle-latest')opts.speed='fast';
   try{rt=await client.realtime.connect(session.input,opts);break}
   catch(error){if(current!==session||session.cancelled)return;const msg=String(error?.message||error);if(attempt<3&&/stale connect|reconnect cancelled|timeout|websocket|closed/i.test(msg)){continue}throw error}
  }
  if(current!==session||session.cancelled){rt.disconnect();session.input.getTracks().forEach(t=>t.stop());return}
  session.rt=rt;session.status='connected';
  rt.on('generationTick',({seconds})=>{if(current!==session)return;session.serverSeconds=Math.max(session.serverSeconds||0,Number(seconds)||0);commitUsage(session,session.serverSeconds);renderMetrics(session)});
  rt.on('generationEnded',({seconds})=>{if(current!==session)return;if(Number.isFinite(seconds)){session.serverSeconds=Math.max(session.serverSeconds||0,seconds);commitUsage(session,session.serverSeconds);renderMetrics(session)}});
  rt.on('stats',stats=>{if(current!==session)return;lastFps=stats.video?.framesPerSecond??null;lastRtt=stats.connection?.currentRoundTripTime??stats.remoteInbound?.roundTripTime??null;renderMetrics(session)});
  rt.on('queuePosition',queue=>{if(current!==session)return;session.queue=queue.position!=null?'第 '+queue.position+' 位':'';renderState()});
  rt.on('connectionChange',status=>{if(current!==session)return;log('连接状态 '+status);if(status==='disconnected'){stopSession('连接已断开');return}session.status=status==='reconnecting'?'reconnecting':'connected';renderState()});
  rt.on('error',error=>{if(current!==session)return;log('试穿错误：'+cleanError(error));toast('连接提示：'+cleanError(error),true);if(!rt.isConnected())stopSession('连接中断，请重试')});
  rt.on('sessionEnded',event=>{if(current!==session)return;const reason=event?.reason==='insufficient_credits'?'账户积分不足，请到官方控制台查看':'服务器已结束本次会话';stopSession(reason)});
  renderState();log('AI 试穿已连接 '+session.modelName+' / '+session.speed);
  if(referenceRevision!==session.refRevision)applyReference(false);
 }catch(error){if(current!==session||session.cancelled)return;if(/stale connect/i.test(String(error?.message)))error=Error('连接多次被重置，请检查网络后重试');log('连接失败：'+cleanError(error));await stopSession('试穿连接失败');toast(cleanError(error),true)}
}
async function stopSession(reason='AI 试穿已停止',silent=false){
 const session=current;if(!session)return;current=null;referenceQueue=Promise.resolve();session.cancelled=true;clearInterval(session.timer);
 if(session.frameCallback!=null&&$('outputVideo').cancelVideoFrameCallback)$('outputVideo').cancelVideoFrameCallback(session.frameCallback);session.removeReady?.();
 sessionSeconds=generatedSeconds(session);sessionDollars=sessionSeconds*sessionRate(session);commitUsage(session,sessionSeconds);
 try{session.rt?.disconnect()}catch(error){log(error)}session.input.getTracks().forEach(t=>t.stop());
 $('outputVideo').srcObject=null;setCompare(false);renderState();renderMetrics(null);log(reason);if(!silent&&!pageClosing)toast(reason);
}
let lastTryClick=0,starting=false;
$('tryButton').onclick=async()=>{const now=Date.now();if(now-lastTryClick<500)return;lastTryClick=now;if(current)return stopSession();if(starting)return;starting=true;try{await startSession()}finally{starting=false}};
function renderOptions(){
 $$('[data-speed]').forEach(b=>{b.classList.toggle('selected',b.dataset.speed===speed);b.disabled=b.dataset.speed==='fast'&&modelName==='lucy-restyle-latest'});
 const rate=modelName==='lucy-restyle-latest'?.01:speed==='fast'?.04:.02;$('priceLabel').textContent=money(rate)+' / 秒';$('speedHint').textContent=speed==='fast'?'更低延迟，更流畅的试穿':'从容探索每一种风格';$('modelSelect').value=modelName;
}
async function reconnectWith(change){const restart=!!current;await stopSession('正在应用新的试穿偏好',true);change();renderOptions();if(restart)await startSession()}
let preferenceBusy=false;
async function changePreference(change){if(preferenceBusy){renderOptions();toast('正在切换，请稍候');return}preferenceBusy=true;try{await reconnectWith(change)}finally{preferenceBusy=false}}
$$('[data-speed]').forEach(b=>b.onclick=()=>{if(speed===b.dataset.speed)return;changePreference(()=>speed=b.dataset.speed)});
$('modelSelect').onchange=()=>{const value=$('modelSelect').value;changePreference(()=>{const previous=modelName;modelName=value;if($('prompt').value===prompts[previous])$('prompt').value=prompts[modelName];if(modelName==='lucy-restyle-latest')speed='standard'})};
function saveSettings(){safeStore.set(STORAGE.settings,JSON.stringify(settings))}
['captureRatio','photoDelay','autoDownload','sessionLimit','idleStop','backgroundStop'].forEach(id=>{const el=$(id);if(el.type==='checkbox')el.checked=!!settings[id];else el.value=String(settings[id]);el.onchange=()=>{settings[id]=el.type==='checkbox'?el.checked:(id==='photoDelay'||id==='sessionLimit'?Number(el.value):el.value);saveSettings()}});
$('openDiagnostics').onclick=()=>$('diagnostics').hidden=!$('diagnostics').hidden;
function toBlob(canvas,type='image/png',quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图像导出失败')),type,quality))}
function createCaptureCanvas(){
 const video=activeVideo();if(!videoReady(video))throw Error('画面尚未就绪，请稍候再拍摄');let w=video.videoWidth,h=video.videoHeight;
 const ratio={portrait:9/16,square:1,landscape:16/9}[settings.captureRatio];if(ratio){if(w/h>ratio)w=Math.round(h*ratio);else h=Math.round(w/ratio)}
 const scale=Math.min(1,1920/Math.max(w,h));const canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(w*scale/2)*2);canvas.height=Math.max(2,Math.round(h*scale/2)*2);return canvas;
}
function drawVideo(context,video,w,h){
 if(!videoReady(video))return;const scale=Math.max(w/video.videoWidth,h/video.videoHeight),width=video.videoWidth*scale,height=video.videoHeight*scale;
 context.save();if(mirrored()){context.translate(w,0);context.scale(-1,1)}context.drawImage(video,(w-width)/2,(h-height)/2,width,height);context.restore();
}
function paintCapture(canvas){const context=canvas.getContext('2d',{alpha:false});const w=canvas.width,h=canvas.height;context.fillStyle='#1d231c';context.fillRect(0,0,w,h);drawVideo(context,activeVideo(),w,h);if(compare&&current?.outputReady){const x=Number($('compareRange').value)/100*w;context.save();context.beginPath();context.rect(0,0,x,h);context.clip();drawVideo(context,$('cameraVideo'),w,h);context.restore();context.fillStyle='#ffffffe0';context.fillRect(x-1,0,2,h)}}
function captureThumbnail(canvas){const thumb=document.createElement('canvas');const scale=Math.min(1,400/canvas.width);thumb.width=Math.round(canvas.width*scale);thumb.height=Math.round(canvas.height*scale);thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);return toBlob(thumb,'image/jpeg',.82)}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
$('snapshotButton').onclick=async()=>{
 if(capturing||!liveCamera())return;capturing=true;renderState();
 try{
  for(let i=Number(settings.photoDelay);i>0;i--){if(!liveCamera())throw Error('摄像头已关闭，拍照已取消');$('countdown').hidden=false;$('countdown').textContent=String(i);await pause(1000)}
  $('countdown').hidden=true;const canvas=createCaptureCanvas();paintCapture(canvas);const [blob,thumbnail]=await Promise.all([toBlob(canvas),captureThumbnail(canvas)]);$('stage').classList.remove('flash');void $('stage').offsetWidth;$('stage').classList.add('flash');setTimeout(()=>$('stage').classList.remove('flash'),400);
  await saveMedia({type:'photo',blob,thumbnail,width:canvas.width,height:canvas.height,look:selected.name,ai:!!current?.outputReady,extension:'png'});
 }catch(error){toast(cleanError(error),true)}finally{capturing=false;$('countdown').hidden=true;renderState()}
};
async function startRecording(){
 if(recording||recordStarting||!liveCamera())return;
 if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){toast('当前浏览器不支持录制，请尝试最新版 Safari、Chrome 或 Edge',true);return}
 recordStarting=true;renderState();let captureStream=null;
 try{
  const canvas=createCaptureCanvas();paintCapture(canvas);const stream=canvas.captureStream(30);captureStream=stream;const supported=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));const options={videoBitsPerSecond:6000000};if(supported)options.mimeType=supported;
  const recorder=new MediaRecorder(stream,options);const chunks=[];const start=performance.now();const thumbnail=await captureThumbnail(canvas);if(!liveCamera()||pageClosing){stream.getTracks().forEach(t=>t.stop());return}
  const item={recorder,stream,canvas,chunks,start,thumbnail,look:selected.name,ai:!!current?.outputReady,frame:0,finished:null};
  item.finished=new Promise(resolve=>{item.resolve=resolve});recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
  recorder.onerror=event=>{toast('录制出现问题：'+cleanError(event.error),true);log(event.error);stopRecording()};
  recorder.onstop=async()=>{
   stream.getTracks().forEach(t=>t.stop());cancelAnimationFrame(item.frame);if(recording===item)recording=null;renderRecording();renderState();
   try{const type=recorder.mimeType||supported||'video/webm';const blob=new Blob(chunks,{type});if(!blob.size)throw Error('未录到有效视频，请稍后重试');await saveMedia({type:'video',blob,thumbnail,width:canvas.width,height:canvas.height,look:item.look,ai:item.ai,duration:Math.round((performance.now()-start)/1000),extension:type.includes('mp4')?'mp4':'webm'})}catch(error){toast(cleanError(error),true)}finally{item.resolve()}
  };
  recording=item;const draw=()=>{if(recording!==item)return;paintCapture(canvas);$('recordingTime').textContent=formatTime(Math.floor((performance.now()-start)/1000));if(performance.now()-start>=600000){stopRecording();return}item.frame=requestAnimationFrame(draw)};recorder.start(1000);draw();renderRecording();renderState();toast('录制已开始，再点一次即可保存。最长 10 分钟。');
 }catch(error){toast('录制开启失败：'+cleanError(error),true);log(error);captureStream?.getTracks().forEach(t=>t.stop());if(recording)recording=null;renderRecording()}finally{recordStarting=false;renderState()}
}
function renderRecording(){const on=!!recording;$('recordingBadge').hidden=!on;$('recordButton').classList.toggle('recording',on);$('recordButton').innerHTML=icon('video')+`<span>${on?'停止录制':'录制'}</span><kbd>R</kbd>`;if(!on)$('recordingTime').textContent='00:00'}
async function stopRecording(){const item=recording;if(!item)return;if(item.recorder.state!=='inactive')item.recorder.stop();return item.finished}
$('recordButton').onclick=()=>recording?stopRecording():startRecording();
function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('mirra-lookbook',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('media'))request.result.createObjectStore('media',{keyPath:'id'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function dbRequest(mode,operation){return new Promise((resolve,reject)=>{if(!db){reject(Error('本机作品库未就绪'));return}const transaction=db.transaction('media',mode);let result;const req=operation(transaction.objectStore('media'));req.onsuccess=()=>{result=req.result};transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('本机保存中断'))})}
async function saveMedia(data){
 const entry={...data,id:crypto.randomUUID(),createdAt:Date.now(),filename:'MIRRA-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+data.extension};
 let persisted=false;try{await dbRequest('readwrite',store=>store.put(entry));persisted=true}catch(error){log('本机作品库：'+cleanError(error))}
 gallery.unshift(entry);renderGallery();
 if(settings.autoDownload)downloadEntry(entry);
 toast(persisted?((entry.type==='photo'?'照片已保存':'录制完成')+(settings.autoDownload?'，已启动本地下载':'，已存入本机作品库')):'作品暂存于当前页面，请及时下载',!persisted,{label:'再次下载',run:()=>downloadEntry(entry)});
}
function thumbnailURL(entry){if(!objectURLs.has(entry.id))objectURLs.set(entry.id,URL.createObjectURL(entry.thumbnail||entry.blob));return objectURLs.get(entry.id)}
function mediaCard(entry){const card=document.createElement('button');card.className='media-card';const wrap=document.createElement('span');wrap.className='media-card-image';const image=new Image();image.src=thumbnailURL(entry);image.alt=entry.look+' · '+(entry.type==='photo'?'照片':'视频');image.loading='lazy';wrap.append(image);const badge=document.createElement('span');badge.innerHTML=icon(entry.type==='video'?'video':'camera');badge.append(document.createTextNode(entry.type==='video'?formatTime(entry.duration):entry.ai?'AI 试穿':'本地预览'));wrap.append(badge);const text=document.createElement('span');text.className='media-card-text';const name=document.createElement('span');name.textContent=entry.look;const time=document.createElement('small');time.textContent=new Date(entry.createdAt).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'});text.append(name,time);card.append(wrap,text);card.onclick=()=>openMedia(entry);return card}
function renderGallery(){
 $('galleryCount').textContent=String(gallery.length);const recent=$('recentGallery');recent.replaceChildren();
 if(!gallery.length){const empty=document.createElement('div');empty.className='recent-empty';empty.innerHTML=icon('camera')+'<p>第一张新造型，等你来拍。</p><span>照片与视频保存在本机作品库，也可以下载到本地。</span>';recent.append(empty)}else gallery.slice(0,5).forEach(entry=>recent.append(mediaCard(entry)));
 const full=$('fullGallery');full.replaceChildren();const visible=gallery.filter(entry=>mediaFilter==='all'||entry.type===mediaFilter);if(!visible.length){const empty=document.createElement('div');empty.className='recent-empty';empty.innerHTML=icon('image')+'<p>还没有'+(mediaFilter==='video'?'录制的视频':mediaFilter==='photo'?'拍摄的照片':'作品')+'</p><span>回到试穿工作室，留下你的第一套造型。</span>';full.append(empty)}else visible.forEach(entry=>full.append(mediaCard(entry)));
 const size=gallery.reduce((sum,e)=>sum+e.blob.size+(e.thumbnail?.size||0),0);$('gallerySize').textContent=gallery.length+' 件作品 · '+(size/1024/1024).toFixed(1)+' MB';
}
$$('[data-media]').forEach(b=>b.onclick=()=>{mediaFilter=b.dataset.media;$$('[data-media]').forEach(t=>t.classList.toggle('selected',t===b));renderGallery()});
function openMedia(entry){
 currentMedia=entry;$('mediaTitle').textContent=entry.look+' / '+(entry.type==='photo'?'PHOTO':'VIDEO');if(mediaURL)URL.revokeObjectURL(mediaURL);mediaURL=URL.createObjectURL(entry.blob);const element=document.createElement(entry.type==='video'?'video':'img');element.src=mediaURL;if(entry.type==='video'){element.controls=true;element.playsInline=true}else element.alt=entry.look;
 $('mediaPreview').replaceChildren(element);$('mediaMeta').textContent=`${entry.width} × ${entry.height} · ${(entry.blob.size/1024/1024).toFixed(1)} MB · ${entry.extension.toUpperCase()} · ${new Date(entry.createdAt).toLocaleString()}`;showDialog('mediaDialog');
}
function downloadEntry(entry){const url=URL.createObjectURL(entry.blob);const a=document.createElement('a');a.href=url;a.download=entry.filename;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
$('downloadMedia').onclick=()=>{if(currentMedia)downloadEntry(currentMedia)};
$('shareMedia').onclick=async()=>{if(!currentMedia)return;const file=new File([currentMedia.blob],currentMedia.filename,{type:currentMedia.blob.type});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'MIRRA · '+currentMedia.look})}catch(error){if(error.name!=='AbortError')toast('分享未完成：'+cleanError(error),true)}}else{downloadEntry(currentMedia);toast('已启动下载，可通过设备文件管理器分享')}};
$('deleteMedia').onclick=()=>{if(currentMedia)showDialog('confirmDialog')};
$('confirmDelete').onclick=async()=>{const entry=currentMedia;if(!entry)return;try{if(db)await dbRequest('readwrite',store=>store.delete(entry.id));gallery=gallery.filter(item=>item.id!==entry.id);if(objectURLs.has(entry.id)){URL.revokeObjectURL(objectURLs.get(entry.id));objectURLs.delete(entry.id)}$('confirmDialog').close();$('mediaDialog').close();renderGallery();toast('作品已删除')}catch(error){toast('删除未完成：'+cleanError(error),true)}};
['pointerdown','keydown','touchstart'].forEach(name=>addEventListener(name,()=>{lastActivity=Date.now()},{passive:true}));
addEventListener('keydown',e=>{if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||$$('dialog[open]').length||e.target.closest('input,textarea,select,[contenteditable=true]')||currentView!=='studio')return;if(e.target.closest('button,a,summary')&&e.code==='Space')return;if(e.code==='KeyS'){e.preventDefault();$('snapshotButton').click()}else if(e.code==='KeyR'){e.preventDefault();$('recordButton').click()}else if(e.code==='Space'){e.preventDefault();$('tryButton').click()}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&settings.backgroundStop){stopSession('页面已进入后台，AI 试穿已停止');stopRecording()}});
addEventListener('pagehide',()=>{pageClosing=true;const session=current;if(session){commitUsage(session,generatedSeconds(session));current=null;clearInterval(session.timer);session.cancelled=true;try{session.rt?.disconnect()}catch{}session.input.getTracks().forEach(t=>t.stop())}if(recording&&recording.recorder.state!=='inactive')recording.recorder.stop();cameraStream?.getTracks().forEach(t=>t.stop())});
addEventListener('pageshow',event=>{pageClosing=false;if(event.persisted){cameraStream=null;renderState()}});
addEventListener('unhandledrejection',event=>log('后台提示：'+cleanError(event.reason)));
async function init(){
 renderGarments();renderKey();renderOptions();renderState();renderMetrics();renderGallery();
 if(key)try{keyHash=await fingerprint(key);updateUsage()}catch(error){log(error)}
 try{db=await openDB();gallery=(await dbRequest('readonly',store=>store.getAll())).sort((a,b)=>b.createdAt-a.createdAt);renderGallery()}catch(error){log('作品库暂不可用：'+cleanError(error));toast('浏览器未开放本机作品库，拍摄后请及时下载',true)}
 if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream)$('recordButton').title='当前浏览器不支持录制，请尝试最新版 Safari、Chrome 或 Edge';
 log('MIRRA 已准备就绪');
}
init();
})();
