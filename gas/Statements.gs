const BANK_COLUMNS={
  ref:['utr','utr no','utr number','upi transaction id','upi reference number','upi ref no','rrn','reference','reference number','reference no','transaction id','chq ref no','ref no','cheque ref no','cheque reference number','transaction reference number'],
  credit:['credit','credit amount','deposits','deposit','deposit amount','deposit amt','deposits cr','credit inr','credit amount inr'],
  debit:['debit','debit amount','withdrawal','withdrawals','withdrawal amount','withdrawal amt','withdrawals dr','debit inr','debit amount inr'],
  amount:['amount','transaction amount','amount inr','amount rs'],direction:['type','transaction type','direction','dr cr','cr dr','debit credit','credit debit'],
  date:['date','value date','value dt','transaction dt','transaction date','txn date','transaction time','date and time','date time','posting date'],
  description:['description','remarks','transaction remarks','narration','particulars','transaction description','details'],
  receiver:['receiver upi','receiver upi id','beneficiary upi id','payee vpa','receiver vpa','receiver','payee upi id'],
  currency:['currency','ccy'],status:['status','transaction status']
};
function bankHeader_(v){return String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function bankMap_(cells){
  const header=cells.map(bankHeader_),cols={};
  for(const [field,aliases] of Object.entries(BANK_COLUMNS)){
    const hits=header.map((x,i)=>aliases.includes(x)?i:-1).filter(i=>i>=0);
    cols[field]=hits.length===1?hits[0]:-1;
    if(field==='date'&&hits.length>1)cols[field]=hits.find(i=>['transaction date','txn date','date','posting date'].includes(header[i]))??hits[0];
    else if(hits.length>1)cols.ambiguous=true;
  }
  return (cols.ref>=0||cols.description>=0)&&(cols.credit>=0||cols.amount>=0||cols.debit>=0)?cols:null;
}
function bankDate_(v){
  const s=String(v||'').trim(),iso=s.match(/^(\d{4}-\d{2}-\d{2})(?:\b|T)/);
  const us=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\b|T)/);
  if(us&&Number(us[1])<=12&&Number(us[2])>12)return localPaidTime_(us[3]+'-'+us[1].padStart(2,'0')+'-'+us[2].padStart(2,'0')+'T00:00').slice(0,10);
  if(us&&Number(us[1])<=12&&Number(us[2])<=12&&Number(us[1])!==Number(us[2]))return '';
  if(iso)return localPaidTime_(iso[1]+'T00:00').slice(0,10);
  return readPaymentText_(s.replace(/\b\d{1,2}:\d{2}.*$/,'')+' 00:00').time.slice(0,10);
}
function statementRows_(grid,receiver,sheet,source){
  let cols;const rows=[];
  for(let i=0;i<grid.length;i++){
    const cells=grid[i].map(x=>String(x??'').trim());
    if(cells.every(x=>!x))continue;
    const header=bankMap_(cells);if(header){cols={...header,width:cells.length};continue}
    const raw=cells.join(' | ').slice(0,500);
    if(!cols){rows.push({refs:[...new Set(cells.join(' ').match(/\b\d{12}\b/g)||[])],line:sheet+' '+(i+1),raw,utr:'',minor:null,direction:'',date:'',ocr:source==='pdf',issue:'Unrecognized statement columns'});continue}
    const get=k=>cells[cols[k]]||'',reasons=[];
    const rawRef=get('ref'),narration=get('description');
    const refs=[...new Set((rawRef+' '+narration).match(/\b\d{12}\b/g)||[])],utr=refs.length===1?refs[0]:'';
    if(!utr)reasons.push('Missing or ambiguous full UTR');
    if(cols.ambiguous)reasons.push('Ambiguous statement headers');
    if(cells.some(x=>/^(?:=|\[formula\])/.test(x)))reasons.push('Formula in statement row');
    const fieldMoney=v=>!v||/^(?:[-–—]|N\/A)$/i.test(v)?0:paise_(v);
    let minor=null,direction='';
    if(cols.credit>=0||cols.debit>=0){
      const cr=fieldMoney(get('credit')),dr=fieldMoney(get('debit'));
      if(cr!==null&&dr!==null&&cr>0&&dr===0){direction='CREDIT';minor=cr}
      if(cr!==null&&dr!==null&&dr>0&&cr===0){direction='DEBIT';minor=dr}
    }else{
      minor=paise_(get('amount'));const t=bankHeader_(get('direction'));
      if(['cr','credit','deposit','received'].includes(t))direction='CREDIT';
      if(['dr','debit','withdrawal','paid'].includes(t))direction='DEBIT';
    }
    if(cols.direction>=0&&Boolean(get('direction'))){
      const type=bankHeader_(get('direction'));
      if(direction==='CREDIT'&&!['cr','credit','deposit','received'].includes(type)||direction==='DEBIT'&&!['dr','debit','withdrawal','paid'].includes(type))reasons.push('Conflicting transaction direction');
    }
    if(direction!=='CREDIT')reasons.push(direction==='DEBIT'?'Debit, not an incoming credit':'Credit direction is unclear');
    if(!Number.isSafeInteger(minor)||minor<=0)reasons.push('Amount is unclear');
    if(get('currency')&&!['INR','RS','₹'].includes(get('currency').toUpperCase()))reasons.push('Foreign currency');
    if(get('receiver')&&get('receiver').toLowerCase()!==receiver.upi)reasons.push('Statement receiver differs');
    if(/\b(?:UPI\/DR\/|DEBITED\b)/i.test(narration)&&direction==='CREDIT')reasons.push('Debit wording conflicts with the credit column');
    if(/\b(?:revers(?:al|ed)|refund(?:ed)?|chargeback|failed|pending|cancelled)\b/i.test(narration+' '+get('status')))reasons.push('Reversal, refund or unconfirmed transaction');
    if(get('status')&&!/^(success(?:ful)?|completed|settled|posted|credited)$/i.test(get('status')))reasons.push('Unrecognized bank status');
    const date=bankDate_(get('date'));
    if(!date)reasons.push('Bank transaction date is unclear');
    const printedDirection=['cr','credit','deposit','received'].includes(bankHeader_(get('direction')))||/\b(?:credited|credit|received)\b/i.test(narration);
    const pdfNeedsCheck=source==='pdf'&&(!printedDirection||cells.length!==cols.width||!!reasons.length);
    rows.push({line:sheet+' '+(i+1),raw,utr,refs,minor,direction,date,issue:reasons.join('. '),ocr:pdfNeedsCheck});
  }
  return rows;
}
function statementCsv_(text,separator){
  const rows=[],row=[];let value='',quoted=false,closed=false;
  function field(){row.push(value);value='';closed=false;must_(row.length<=100,'Too many statement columns.')}
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'){if(text[i+1]==='"'){value+='"';i++}else{quoted=false;closed=true}}
      else value+=ch;
    }else if(ch===separator)field();
    else if(ch==='\r'||ch==='\n'){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      field();rows.push(row.splice(0));must_(rows.length<=5001,'Split this statement into shorter date ranges.');
    }else if(ch==='"'&&!value.trim()&&!closed){value='';quoted=true}
    else{must_(!closed||ch===' '||ch==='\t','Invalid quoted CSV field.');value+=ch}
  }
  must_(!quoted,'Unclosed quoted field in the CSV.');
  if(value||row.length||closed){field();rows.push(row)}
  return rows;
}
function parseStatement_(blob,ext,receiver){
  let rows=[];
  if(ext==='csv'){
    let text=blob.getDataAsString('UTF-8').replace(/^\ufeff/,'');
    if(/[\x00\ufffd]/.test(text))throw Error('Export the CSV as UTF-8 and upload it again.');
    const formats=[',',';','\t'];let best,rank=-1;
    for(const separator of formats){
      let grid;try{grid=statementCsv_(text,separator)}catch{continue}
      const score=grid.slice(0,100).filter(line=>bankMap_(line)).length;
      if(score>rank){best=grid;rank=score}
    }
    must_(best&&rank>0,'No transaction header was recognized. Use columns such as Date, UTR, Credit and Debit, or Amount and Type.');
    rows=statementRows_(best,receiver,'Row','csv');
  }else if(ext==='xls'||ext==='xlsx'){
    rows=convertPaymentFile_(blob,'application/vnd.google-apps.spreadsheet',id=>{
      const all=[];
      for(const sheet of SpreadsheetApp.openById(id).getSheets()){
        const range=sheet.getDataRange();
        must_(range.getNumRows()<=5000&&range.getNumColumns()<=80,'Export only the statement period and transaction columns.');
        const grid=range.getDisplayValues(),formulas=range.getFormulas();
        for(let i=0;i<grid.length;i++)for(let j=0;j<grid[i].length;j++)if(formulas[i][j])grid[i][j]='[formula] ='+grid[i][j];
        const parsed=statementRows_(grid,receiver,sheet.getName(),'excel');
        all.push(...parsed);
      }
      return all;
    });
  }else{
    const doc=paymentDocument_(blob);
    if(doc.tables.length)doc.tables.forEach((grid,n)=>rows.push(...statementRows_(grid,receiver,'Table '+(n+1)+' row','pdf')));
    // Each line is evidence. Never infer a credit from a bare amount or a running balance.
    const lines=(rows.length?(doc.paragraphs||[]).join('\n'):doc.text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(lines.length){
      const grid=lines.map(line=>line.split(/\t+|\s{2,}|\s*\|\s*/));
      rows.push(...statementRows_(grid,receiver,'Line','pdf'));
      for(let i=0;i<rows.length;i++)if(!rows[i].utr){
        const refs=[...new Set(rows[i].raw.match(/\b\d{12}\b/g)||[])];
        if(refs.length===1)rows[i].utr=refs[0];
      }
    }
    must_(rows.length,'No text could be read from the PDF. Upload an unlocked statement or its CSV/Excel export.');
  }
  must_(rows.length>0&&rows.length<=4000,'Choose a statement with 1–4,000 nonempty rows. Split larger date ranges.');
  const identities=rows.filter(r=>r.issue==='Unrecognized statement columns').flatMap(r=>Array.from(r.raw.matchAll(/^(?:receiver(?: upi(?: id)?)?|beneficiary upi id|account upi id|payee vpa)\s*[:|\s]+([\w.-]+@[\w.-]+)/gi),m=>m[1].toLowerCase()));
  if(identities.some(upi=>upi!==receiver.upi))for(const row of rows)row.issue=[row.issue,'Statement receiver differs'].filter(Boolean).join('. ');
  return rows;
}
function statementFile_(filename,data){
  const name=String(filename||'').split(/[\\/]/).pop().slice(0,140),ext=name.toLowerCase().split('.').pop();
  const types={csv:'text/csv',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf'};
  must_(Object.hasOwn(types,ext)&&typeof data==='string'&&data.length<=8400000&&/^[A-Za-z0-9+/]+={0,2}$/.test(data),'Choose a CSV, Excel or PDF statement under 6 MB.');
  const bytes=Utilities.base64Decode(data),head=bytes.slice(0,8).map(n=>n&255);
  must_(bytes.length>0&&bytes.length<=6*1024*1024,'The statement is empty or too large.');
  const signatures={pdf:[37,80,68,70,45],xlsx:[80,75,3,4],xls:[208,207,17,224,161,177,26,225]};
  must_(!signatures[ext]||signatures[ext].every((b,i)=>head[i]===b),'The file contents do not match the extension. Export the original from the bank.');
  return {name,ext,bytes,blob:Utilities.newBlob(bytes,types[ext],name),digest:proofDigest_(bytes)};
}
function statementView_(s){return {id:s.id,name:s.name,receiver:s.receiver.name,receiverId:s.receiver.id,rows:s.count,applied:!!s.applied,created:s.created}}
function adminImportStatement(token,receiverId,filename,data){
  const user=staff_(token,[]),source=statementFile_(filename,data),st=ledger_(),receiver=st.receivers[receiverId];
  must_(receiver,'Select the statement’s receiving account.');
  const id=hash_('statement:'+source.digest);
  const existing=st.statements[id];
  if(existing){must_(existing.receiver.id===receiverId,'These same statement bytes are already registered to another receiver.');
    locked_(()=>commit_(ledger_(),'Duplicate statement upload',user.name,{note:source.name+' · '+id}));return adminStatementPreview(token,id)}
  let rows;
  try{rows=parseStatement_(source.blob,source.ext,receiver)}
  catch(e){throw Error('Statement could not be imported. '+e.message)}
  const folder=DriveApp.getFolderById(props_().getProperty('FOLDER'));
  locked_(()=>{
    const live=ledger_(),prior=live.statements[id];
    if(prior){must_(prior.receiver.id===receiverId,'These same statement bytes belong to another receiver.');return}
    must_(live.receivers[receiverId]?.revision===receiver.revision,'The receiving account changed. Check it before uploading again.');
    const original=folder.createFile(source.blob);
    const manifest=folder.createFile(Utilities.newBlob(JSON.stringify(rows),'application/json','bank-rows-'+id+'.json'));
    const item={id,name:source.name,ext:source.ext,receiver:receiverView_(receiver),original:original.getId(),manifest:manifest.getId(),count:rows.length,created:Date.now(),applied:false};
    commit_(live,'Statement uploaded for preview',user.name,{statements:[item],note:receiver.name+' · '+source.name});
  });
  return adminStatementPreview(token,id);
}
function bankRows_(st,includeId,includeStaged=false){
  const all=[];
  for(const s of Object.values(st.statements)){
    if(!includeStaged&&!s.applied&&s.id!==includeId)continue;
    const rows=JSON.parse(DriveApp.getFileById(s.manifest).getBlob().getDataAsString());
    must_(Array.isArray(rows)&&rows.length===s.count,'Statement rows could not be verified. Contact the club administrator.');
    rows.forEach((row,i)=>{const key=s.id+'.'+i,fix=st.bankCorrections[key];all.push({...row,...(fix?.values||{}),key,applied:!!s.applied,statement:s.id,account:s.receiver.id,upi:s.receiver.upi,source:s.name})});
  }
  return all;
}
