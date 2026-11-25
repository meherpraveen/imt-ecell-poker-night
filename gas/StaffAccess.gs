function staffList_(){const s=book_().getSheetByName('Staff'),n=s.getLastRow()-1;return n?s.getRange(2,1,n,4).getDisplayValues():[]}
function activeStaff_(row){return row[3].toLowerCase()==='yes'&&ROLE.includes(row[1])&&/^[a-z0-9]{40}$/i.test(row[2])&&(row[1]!=='admin'||(!!emailAddress_(row[0])&&emailAddress_(row[0])===clubOwner_()))}
function staffInvite_(key){
  const signature=Utilities.computeHmacSha256Signature('poker-night:staff-link:v1',key);
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/,'');
}
function invitedStaff_(invite){
  if(typeof invite!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(invite))return null;
  return staffList_().find(row=>activeStaff_(row)&&staffInvite_(row[2])===invite);
}
function deskBaseUrl_(){
  const url=(typeof CLUB_RESOURCES==='object'&&CLUB_RESOURCES.webAppUrl)||ScriptApp.getService().getUrl()||'';
  return /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/s|macros\/s)\/[\w-]+\/exec$/.test(url)?url:'';
}
function staffDeskLink_(base,key){return base+'?view=staff&invite='+staffInvite_(key)}
function ensureStaffLinks_(){
  // Upgrade pre-invitation workbooks once. All inputs come from the club's own configuration.
  const properties=props_();
  if(properties.getProperty('STAFF_LINKS_V1'))return;
  locked_(()=>{
    if(properties.getProperty('STAFF_LINKS_V1'))return;
    const staff=book_().getSheetByName('Staff');
    if(staff&&syncStaffLinks_(staff))properties.setProperty('STAFF_LINKS_V1','ready');
  });
}
function syncStaffLinks_(sheet){
  const base=deskBaseUrl_();
  if(!base)return false;
  const title='Private desk link';
  const headers=sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(),4)).getDisplayValues()[0];
  const existing=headers.indexOf(title);
  const column=existing<0?headers.length+1:existing+1;
  if(existing<0)sheet.getRange(1,column).setValue(title);
  const count=sheet.getLastRow()-1;
  if(count<=0)return true;
  const staff=sheet.getRange(2,1,count,4).getDisplayValues();
  const range=sheet.getRange(2,column,count,1);
  const current=range.getDisplayValues();
  const links=staff.map(row=>[activeStaff_(row)?staffDeskLink_(base,row[2]):'']);
  if(links.some((cell,i)=>cell[0]!==current[i][0]))range.setValues(links);
  return true;
}
function staffLogin(key,invite){
  key=String(key||'').trim();must_(/^[a-z0-9]{40}$/i.test(key),'Check your staff key.');
  must_(typeof invite==='string'&&staffInvite_(key)===invite,'Use the private link and key issued to you.');
  const row=staffList_().find(r=>r[2]===key&&activeStaff_(r));
  must_(row,'Check your staff access with the coordinator.');
  must_(row[1]!=='admin','Open the owner’s private desk link and sign in to the club account.');
  return staffSession_(row);
}
function staff_(token,roles){
  return staffClaims_(authSession_(token,'staff'),roles);
}
function staffClaims_(session,roles){
  must_(session&&session.type==='staff'&&session.expires>Date.now()&&passwordSessionValid_(session),STAFF_SIGN_IN);
  const r=staffList_().find(x=>activeStaff_(x)&&x[1]===session.role&&hash_(x[2]).slice(0,24)===session.staffId);
  must_(r&&(r[1]==='admin'||roles.includes(r[1])),'Your staff role cannot perform that action.');
  return {name:r[0],role:r[1]};
}
