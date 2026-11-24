function directoryPerson_(row){return {name:row[1],email:row[2].trim(),phone:row[3].replace(/\D/g,'')}}
function uniqueDirectoryRow_(sheet,column,value){
  const literal=value.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
  const matches=sheet.getRange(column).createTextFinder('^\\s*'+literal+'\\s*$')
    .useRegularExpression(true).matchCase(false).findAll();
  return matches.length===1?matches[0].getRow():0;
}
function directoryRecord_(identifier){
  const byRoll=/^\d{9}$/.test(identifier);
  const value=byRoll?identifier:emailAddress_(identifier);
  if(!value)return null;
  const sheet=book_().getSheetByName('Students');
  const index=uniqueDirectoryRow_(sheet,byRoll?'A:A':'C:C',value);
  if(index<2)return null;
  const row=sheet.getRange(index,1,1,4).getDisplayValues()[0];
  const roll=row[0].trim(),person=directoryPerson_(row),email=emailAddress_(person.email);
  if(!/^\d{9}$/.test(roll)||!email||(byRoll?roll:email)!==value)return null;
  if(uniqueDirectoryRow_(sheet,byRoll?'C:C':'A:A',byRoll?email:roll)!==index)return null;
  return {roll,email,person};
}
function directoryPlayer_(roll){
  return directoryRecord_(roll)?.person||null;
}
function roster_(){
  const sheet=book_().getSheetByName('Students'),n=sheet.getLastRow()-1,people={};
  if(n>0)sheet.getRange(2,1,n,4).getDisplayValues().forEach(row=>{
    const roll=row[0].trim();if(/^\d{9}$/.test(roll))people[roll]=directoryPerson_(row);
  });
  return people;
}

function deskStudent(token,roll,name,email,phone,checked){
  const staff=staff_(token,['desk']);roll=roll_(roll);name=String(name||'').trim();email=String(email||'').trim().toLowerCase();phone=String(phone||'').replace(/[ +()-]/g,'');
  must_(checked===true&&name&&name.length<=100&&!/^[=+@-]/.test(name),'Check the college ID and enter the student’s name.');
  must_((!email||emailAddress_(email))&&(!phone||/^\d{10,15}$/.test(phone))&&(email||phone),'Enter a valid delivery email or mobile number.');
  return locked_(()=>{const sheet=book_().getSheetByName('Students'),count=sheet.getLastRow()-1;
    const data=count?sheet.getRange(2,1,count,4).getDisplayValues():[],i=data.findIndex(r=>r[0].trim()===roll);
    must_(!data.some((r,index)=>index!==i&&(r[0].trim()===roll||email&&emailAddress_(r[2])===email)),
      'More than one directory record would use this roll or email. The coordinator must resolve it in the private directory.');
    const existing=i>=0?data[i]:null;
    if(existing)must_((!existing[2]||!email||emailAddress_(existing[2])===email)&&(!existing[3]||!phone||existing[3].replace(/\D/g,'')===phone),'An existing contact differs. The coordinator must resolve it in the private directory.');
    const row=i>=0?i+2:sheet.getLastRow()+1;
    sheet.getRange(row,1,1,4).setNumberFormat('@').setValues([[roll,existing?.[1]||name,existing?.[2]||email,existing?.[3]||phone]]);
    commit_(ledger_(),'Directory contact verified',staff.name,{note:roll});return true;
  });
}
