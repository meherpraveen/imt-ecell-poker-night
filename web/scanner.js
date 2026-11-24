'use strict';
let mediaStream=null,cameraGeneration=0,frameTimer,decoderReady,pendingScan=null,readingTicket=false;

function stopScanner(){
  cameraGeneration++;clearTimeout(frameTimer);
  mediaStream?.getTracks().forEach(track=>track.stop());mediaStream=null;
}
function launchScanner(message=''){
  stopScanner();document.body.dataset.scanState='ready';
  const manual='<details><summary>Enter a ticket code</summary><form data-action="manualScan">'+
    input('manualCode','Entry code','required autocomplete="off" autocapitalize="characters" placeholder="PN-…"')+
    '<button type="submit">Check ticket</button></form></details>';
  el('content').innerHTML='<div class="narrow">'+panel('Scan a ticket','<p>Check the player’s college ID, then point the camera at their QR.</p>'+
    (message?'<p class="note" role="status">'+esc(message)+'</p>':'')+btn('startCamera','Start camera','primary wide')+manual)+'</div>';
}
async function checkScannedTicket(){
  if(!pendingScan||readingTicket)return;
  readingTicket=true;stopScanner();document.body.dataset.scanState='verifying';msg();
  el('content').innerHTML=skeleton('Checking the ticket with the gate');
  try{
    const result=await api('scanEntryTicket',scannerAccess,pendingScan.code,pendingScan.id);
    pendingScan=null;document.body.dataset.scanState='result';
    el('content').innerHTML=gateResultHtml(result,btn('nextScan','Scan next ticket','primary wide'));
    el('scanResultTitle').focus();
  }catch(e){
    const signedOut=/sign in|staff role/i.test(e.message);
    el('content').innerHTML='<div class="narrow">'+panel(signedOut?'Staff sign-in required':'Check-in unconfirmed',
      '<p>'+esc(signedOut?'Open the scanner again from your signed-in gate desk.':'Keep the player at the gate. Reconnect to check this ticket.')+'</p>'+
      (signedOut?'':btn('retryScan','Retry this ticket','primary wide')))+'</div>';
  }finally{readingTicket=false}
}
async function readCode(code){
  if(readingTicket||pendingScan)return;
  pendingScan={code,id:crypto.randomUUID()};
  await checkScannedTicket();
}
async function startCamera(){
  stopScanner();
  if(!navigator.mediaDevices?.getUserMedia){launchScanner('Camera access is unavailable. Enter the code printed on the ticket.');return}
  const generation=cameraGeneration;
  document.body.dataset.scanState='camera';
  el('content').innerHTML='<div class="narrow camera-card"><div class="camera-frame"><video id="cameraPreview" autoplay muted playsinline aria-label="Live gate camera"></video><i aria-hidden="true"></i></div><p role="status">Hold one ticket inside the frame.</p>'+btn('cancelCamera','Close camera','quiet')+'</div>';
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
    if(generation!==cameraGeneration){stream.getTracks().forEach(t=>t.stop());return}
    mediaStream=stream;
    const video=el('cameraPreview');video.srcObject=stream;
    await video.play();
    let detector;
    try{
      if(window.BarcodeDetector&&(await BarcodeDetector.getSupportedFormats()).includes('qr_code')){
        detector=new BarcodeDetector({formats:['qr_code']});
      }
    }catch{/* The local decoder also works when the platform cannot open its detector. */}
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    async function frame(){
      if(generation!==cameraGeneration)return;
      if(video.readyState>=2&&video.videoWidth){
        let code;
        if(detector){
          try{code=(await detector.detect(video))[0]?.rawValue}catch{detector=null}
          if(generation!==cameraGeneration)return;
        }
        if(!detector){
          if(typeof jsQR!=='function'){
            decoderReady=decoderReady||scriptAsset('assets/jsQR-1.4.0.js').catch(e=>{decoderReady=null;throw e});
            await decoderReady;
            if(generation!==cameraGeneration)return;
          }
          const scale=Math.min(1,760/Math.max(video.videoWidth,video.videoHeight));
          const width=Math.max(1,Math.round(video.videoWidth*scale)),height=Math.max(1,Math.round(video.videoHeight*scale));
          if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
          ctx.drawImage(video,0,0,width,height);
          const pixels=ctx.getImageData(0,0,width,height);
          code=jsQR(pixels.data,width,height,{inversionAttempts:'dontInvert'})?.data;
        }
        if(code){await readCode(code);return}
      }
      frameTimer=setTimeout(()=>frame().catch(cameraError),180);
    }
    await frame();
  }catch(e){cameraError(e)}
  function cameraError(e){
    if(generation===cameraGeneration)launchScanner(e.name==='NotAllowedError'?'Allow camera access in your browser, or enter the ticket code below.':'Could not start the camera. Try again or enter the ticket code below.');
  }
}
function scannerAction(name){
  if(name==='startCamera'||name==='nextScan'){startCamera();return}
  if(name==='cancelCamera'){launchScanner();return}
  if(name==='retryScan')return checkScannedTicket();
  if(name==='manualScan')return readCode(val('manualCode'));
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&document.body.dataset.scanState==='camera')launchScanner()});
addEventListener('pagehide',stopScanner);
addEventListener('pageshow',event=>{if(event.persisted&&document.body.dataset.scanState==='camera')launchScanner()});
