import jpeg from 'jpeg-js';
import qr from 'qrcode-generator';
import {randomUUID} from 'node:crypto';
import {player, owner} from './e2e/event-runtime.mjs';

export const testUpi='club@samplebank',utr='012345678901',day='2026-11-23',paidAt=day+'T15:00';
export function jpegQr(address=testUpi){
  const m=qr(0,'M');m.addData('upi://pay?pa='+address+'&cu=INR');m.make();
  const modules=m.getModuleCount(),scale=6,size=(modules+8)*scale;
  const data=Buffer.alloc(size*size*4,255);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.floor(y/scale)-4,c=Math.floor(x/scale)-4;
    if(r>=0&&c>=0&&r<modules&&c<modules&&m.isDark(r,c))data.fill(0,(y*size+x)*4,(y*size+x)*4+3);
  }
  return Buffer.from(jpeg.encode({data,width:size,height:size},90).data);
}
export const image='data:image/jpeg;base64,'+jpegQr().toString('base64');
export function receiptText(ref=utr,amount='149.00',payee=testUpi){
  return ['Successfully paid','Paid to: '+payee,'INR '+amount,'UPI Transaction ID: '+ref,'23 Nov 2026 3:00 PM'].join('\n');
}
export const csvHeader='Date,UTR,Credit,Debit,Receiver UPI,Description';
export const credit=(ref=utr,amount='149',address=testUpi)=>[day,ref,amount,'',address,'UPI credit'].join(',');
export function club(event){
  const rpc=(action,...args)=>event.staff(action,args);
  const invite=event.invite('admin');rpc('requestOwnerCode',invite);
  const admin=rpc('verifyOwnerCode',invite,event.code(owner)).token;
  function publicRpc(action,...args){const r=event.post({action,args});if(!r.ok)throw Error(r.error);return r.value}
  function student(roll=player.roll,email=player.email){
    publicRpc('requestEventCode',roll);
    const signed=publicRpc('signInEvent',roll,event.code(email),''),token=signed.session.token;
    const hold=publicRpc('playerStart',token,'',randomUUID(),JSON.stringify({pgpId:roll,fullName:signed.account.player.name,contact:'',batch:'2026-28'}));
    return {token,hold,status:()=>publicRpc('playerStatus',token,hold.ticket)};
  }
  function makeReceiver(upi=testUpi,name='Test receiver'){
    return rpc('adminSaveReceiver',admin,{name,upi,active:true,qr:'data:image/jpeg;base64,'+jpegQr(upi).toString('base64')});
  }
  function submission(p,edits={},proof=image,raw=receiptText()){
    event.ocr(raw);
    const read=publicRpc('playerReadProof',p.token,p.hold.ticket,proof);
    return {proof,values:{utr,amount:'149.00',time:paidAt,payer:'Sample payer',beneficiary:p.hold.beneficiary,receiver:p.hold.receiver.id,paidReceiver:p.hold.receiver.id,agreementVersion:p.hold.fairPlayVersion,revision:p.status().proofVersion,fairPlay:true,ocr:read,...edits}};
  }
  const submit=(p,s)=>publicRpc('playerSubmitPayment',p.token,p.hold.ticket,s.proof,JSON.stringify(s.values));
  function importFile(id,name,bytes){return rpc('adminImportStatement',admin,id,name,Buffer.from(bytes).toString('base64'))}
  const statement=(r,lines=[credit()],name='statement.csv')=>importFile(r.id,name,[csvHeader,...lines].join('\r\n'));
  const apply=plan=>rpc('adminApplyStatement',admin,plan.statement.id,plan.version);
  return {rpc,admin,publicRpc,student,makeReceiver,submission,submit,statement,apply,importFile};
}
