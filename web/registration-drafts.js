'use strict';
function draftKey(type,roll,id){return 'draft:'+roll+':'+type+':'+(id||'new')}
function draftValue(key){return unpack(deviceValue(key))}
const detailInputs=['regName','regContact','regBatch'];
// The server may have saved the first registration just as the browser was closed.
function adoptInitialDetailsDraft(receipt){
  const initial=draftKey('details',receipt.beneficiary),fields=draftValue(initial)?.fields;
  if(!fields||!receipt.details)return;
  const key=draftKey('details',receipt.beneficiary,receipt.id),merged=draftValue(key)?.fields||{};
  const values={regName:receipt.details.fullName,regContact:receipt.details.contact,regBatch:receipt.details.batch};
  for(const id of detailInputs){
    if(typeof fields[id]?.value==='string'&&!merged[id]&&fields[id].value.trim()!==(values[id]||''))merged[id]=fields[id];
  }
  if(Object.keys(merged).length)saveDeviceValue(key,JSON.stringify({fields:merged}));
  saveDeviceValue(initial,'');
}
function mountDetailsDraft(){
  const form=el('regName')?.form,roll=accountInfo?.player?.roll;
  if(!form||!roll||!playerSession)return;
  const r=currentReceipt,key=draftKey('details',roll,r?.id),draft=draftValue(key),editor=el('registrationEditor');
  form.dataset.draftKey=key;
  let restored=false,changedElsewhere=false;
  for(const id of detailInputs){
    const field=el(id),saved=draft?.fields?.[id],base=field.value;field.dataset.original=base;
    if(saved&&typeof saved.value==='string'&&saved.value!==base){
      field.value=saved.value;restored=true;if(saved.base!==base)changedElsewhere=true;
    }
  }
  if(restored){
    if(editor)editor.open=true;
    el('detailDraftNote').textContent=changedElsewhere?'Your saved registration changed while you were away. Review your edits before saving.':'Your unfinished details are restored.';
  }
}
function finishDetailsDraft(form,receipt){
  const key=form.dataset.draftKey;if(!key||!receipt.details)return;
  const nextKey=draftKey('details',receipt.beneficiary,receipt.id),fields=draftValue(key)?.fields||{};
  const values=[receipt.details.fullName,receipt.details.contact,receipt.details.batch];
  detailInputs.forEach((id,i)=>{
    const base=values[i]||'';el(id).dataset.original=base;
    if(fields[id]?.value===base)delete fields[id];else if(fields[id])fields[id].base=base;
  });
  if(key!==nextKey)saveDeviceValue(key,'');
  if(Object.keys(fields).length)saveDeviceValue(nextKey,JSON.stringify({fields}));
  else if(key===nextKey)saveDeviceValue(key,'');
  el('detailDraftNote').textContent='';
}
function rememberDetailInput(event){
  const field=event.target,form=field.form,key=form?.dataset.draftKey;
  if(!key||!detailInputs.includes(field.id)||!playerSession)return;
  const fields=draftValue(key)?.fields||{},value=field.value,base=field.dataset.original;
  if(value===base)delete fields[field.id];else fields[field.id]={base,value};
  const stored=saveDeviceValue(key,Object.keys(fields).length?JSON.stringify({fields}):'');
  const note=el('detailDraftNote');if(note)note.textContent=stored?'Draft saved on this device.':'This browser can keep these edits only in this tab.';
}
document.addEventListener('input',rememberDetailInput);
document.addEventListener('change',rememberDetailInput);

function removeProofDraft(key,marker){
  if(!key||!marker)return;
  if(draftValue(key)?.marker===marker)saveDeviceValue(key,'');
  proofStore('readwrite',store=>{
    const found=store.get(key);
    found.onsuccess=()=>{if(found.result?.marker===marker)store.delete(key)};
  }).catch(()=>{});
}
