import {randomBytes, randomUUID, createHash, createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gzipSync, gunzipSync} from 'node:zlib';
import vm from 'node:vm';

const read = name => readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const source = ['Code','Auth','Floor'].map(name=>read('.deploy/'+name+'.gs')).join('\n');
const template = read('.deploy/App.html');
export const player = {roll:'123456789',email:'player@example.test'};
export const owner = 'owner@example.test';

// Only the Google service boundaries are substituted. Requests use the deployed Apps Script entry points.
function sheet(rows,onRead=()=>{}){
  return {
    getLastRow:()=>rows.length,getLastColumn:()=>Math.max(0,...rows.map(r=>r.length)),
    appendRow(values){rows.push(Array.from(values))},
    insertRowsAfter(row,count){rows.splice(row,0,...Array.from({length:count},()=>[]))},
    getRange(row,col,height=1,width=1){
      if(row==='A:A')return {createTextFinder(pattern){return {useRegularExpression(){return this},findAll:()=>rows.flatMap((cells,i)=>new RegExp(pattern).test(String(cells[0]))?[{getRow:()=>i+1}]:[])}}};
      const values=()=>{onRead(row,height);return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>rows[row-1+i]?.[col-1+j]??''))};
      return {
        getValues:values,getDisplayValues:()=>values().map(r=>r.map(String)),
        setValue(value){this.setValues([[value]]);return this},setNumberFormat(){return this},
        setValues(data){data.forEach((r,i)=>r.forEach((x,j)=>{(rows[row+i-1]??=[])[col+j-1]=x}));return this}
      };
    }
  };
}
function blob(bytes,type,name){
  const buffer=Buffer.from(bytes);
  return {getBytes:()=>[...buffer],getDataAsString:()=>buffer.toString(),getName:()=>name,getContentType:()=>type};
}
function html(source){
  return {source,setTitle(){return this},addMetaTag(){return this}};
}

export function createEvent({freshInstall=false,onSheetRead,onFileCreate,onFileRead,onPassMail}={}){
  const props=new Map([['BOOK','fixture'],['KEY',randomBytes(32).toString('hex')],['FOLDER','proofs']]);
  if(freshInstall)props.set('PAYMENT_VERIFICATION_REQUIRED','yes');
  const cache=new Map(),files=new Map(),mail=[],calls=[];
  let ocrText='',excelSheets=[];
  const convertedSheet={getSheets:()=>excelSheets.map(grid=>({getName:()=>grid.name,getDataRange:()=>({getDisplayValues:()=>grid.cells.map(row=>row.slice()),getFormulas:()=>grid.formulas||grid.cells.map(row=>row.map(()=>'')),getNumRows:()=>grid.cells.length,getNumColumns:()=>Math.max(...grid.cells.map(row=>row.length))})}))};
  const team=Object.fromEntries(['admin','desk','gate','floor'].map(role=>[role,randomBytes(20).toString('hex')]));
  const rows={
    Students:[['Roll Number','Name','Mail ID','Number'],[player.roll,'Sample Student',player.email,'9876501234'],['223456789','Second Student','second@example.test','9876501235']],
    Staff:[['Label','Role','Private sign-in key','Active'],...Object.entries(team).map(([role,key])=>[role==='admin'?owner:'Sample '+role,role,key,'yes'])],
    Settings:[['Setting','Value'],['Receiving UPI ID',''],['Recipient name',''],['Registration open','yes'],['Payment QR file',''],['Payment details published','no']],
    Journal:[['Time','Action','Staff or player','Change JSON']]
  };
  const book={getSheetByName:n=>sheet(rows[n],(row,height)=>onSheetRead?.(n,row,height))};
  let locked=false;
  let now=Date.parse('2026-11-23T15:00:00+05:30'),mailDown=false;
  class Clock extends Date{static now(){return now}}
  const properties={getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v),setProperties:values=>Object.entries(values).forEach(([k,v])=>props.set(k,v)),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)};
  const context={
    Date:Clock,console,CLUB_RESOURCES:{owner,webAppUrl:'https://script.google.com/macros/s/test-event/exec'},
    PropertiesService:{getScriptProperties:()=>properties},SpreadsheetApp:{openById:id=>id==='fixture'?book:convertedSheet,flush(){}},
    LockService:{getScriptLock:()=>({waitLock(){if(locked)throw Error('Fixture lock busy');locked=true},releaseLock(){locked=false}})},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),getAll:keys=>Object.fromEntries(keys.filter(k=>cache.has(k)).map(k=>[k,cache.get(k)])),putAll:values=>Object.entries(values).forEach(([k,v])=>cache.set(k,v)),remove:k=>cache.delete(k)})},
    Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},newBlob:blob,
      computeDigest:(alg,data)=>[...createHash(alg).update(Buffer.from(data)).digest()],
      computeHmacSha256Signature:(data,key)=>[...createHmac('sha256',key).update(data).digest()],
      base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),base64Encode:b=>Buffer.from(b).toString('base64'),
      base64Decode:s=>[...Buffer.from(s,'base64')],gzip:b=>blob(gzipSync(Buffer.from(b.getBytes()))),
      ungzip:b=>blob(gunzipSync(Buffer.from(b.getBytes())))},
    MailApp:{getRemainingDailyQuota:()=>100-mail.length,sendEmail(to,subject,body,options){
      if(mailDown)throw Error('Synthetic mail is offline');
      if(!to.endsWith('@example.test'))throw Error('Test mailbox required');
      mail.push({to,subject,body,options});if(!subject.includes('sign-in'))onPassMail?.({locked});
    }},
    DriveApp:{getFileById:id=>files.get(id),getFolderById:()=>({createFile(b){
      const id=randomUUID();const f={getId:()=>id,getName:b.getName,getBlob:()=>{onFileRead?.({name:b.getName(),locked});return b},setTrashed:()=>files.delete(id),
        getParents:()=>({hasNext:()=>true,next:()=>({getId:()=>'proofs'})})};files.set(id,f);onFileCreate?.({name:b.getName(),locked});return f;
    }})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},
    HtmlService:{createHtmlOutput:html,createTemplateFromFile:()=>({evaluate(){
      const branch=template.replace(/<\? if \(route === 'staff'\) \{ \?>([\s\S]*?)<\? \} else \{ \?>([\s\S]*?)<\? \} \?>/,(_,staff,publicView)=>this.route==='staff'?staff:publicView);
      return html(branch.replace(/<\?= (.*?) \?>/g,(_,key)=>key.startsWith('ownerLogin')?(this.ownerLogin?'yes':''):this[key]||''));
    }})}
  };
  context.Drive={Files:{create(meta,file){return {id:context.DriveApp.getFolderById('proofs').createFile(file).getId()}},export(){if(ocrText===null)throw Error('OCR unavailable');return blob(ocrText)}}};
  context.Docs={Documents:{get(){if(ocrText===null)throw Error('OCR unavailable');return {body:{content:ocrText.split('\n').map(content=>({paragraph:{elements:[{textRun:{content}}]}}))}}}}};
  vm.createContext(context);vm.runInContext(source,context);
  return {mail,calls,team,rows,cache,files,ocr:text=>{ocrText=text},excel:sheets=>{excelSheets=sheets},now:()=>now,advance:ms=>{now+=ms},at:s=>{now=Date.parse(s)},mailFailure:v=>{mailDown=v},
    code(to){return mail.filter(m=>m.to===to&&m.subject.includes('sign-in')).at(-1)?.body.match(/\b\d{6}\b/)?.[0]},
    invite:role=>context.staffInvite_(team[role]),get:params=>context.doGet({parameter:params}).source,
    post(body){calls.push(body.action);return context.doPost({postData:{contents:JSON.stringify(body)}})},
    staff(name,args){calls.push(name);return context[name](...args)}
  };
}
