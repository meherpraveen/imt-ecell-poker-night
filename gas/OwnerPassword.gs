const OWNER_SIGN_IN_MODE='password';
const OWNER_PASSWORD_ERROR='The club sign-in details are incorrect. Check them and try again.';
function ownerSignInMode_(){
  const configured=typeof CLUB_RESOURCES==='object'&&CLUB_RESOURCES.ownerSignIn;
  return (configured||OWNER_SIGN_IN_MODE)==='password'?'password':'email';
}
function ownerPasswordHash_(){
  const configured=typeof CLUB_RESOURCES==='object'&&CLUB_RESOURCES.ownerPasswordHash;
  const hash=props_().getProperty('OWNER_PASSWORD_HASH')||configured||'';
  must_(/^\$2[aby]\$1[0-4]\$[./A-Za-z0-9]{53}$/.test(hash),'Club password sign-in is not configured. Contact the coordinator.');
  return hash;
}
function passwordSessionValid_(session){
  return !session?.passwordTag||(ownerSignInMode_()==='password'&&session.passwordTag===hash_(ownerPasswordHash_()));
}
function ownerPasswordSession_(identity,password,requestId,transfer){
  must_(ownerSignInMode_()==='password','Club email verification is active. Reload the sign-in page.');
  must_(identity&&['owner','owner-entry'].includes(identity.scope),OWNER_PASSWORD_ERROR);
  must_(typeof password==='string'&&password.length>0&&password.length<=72&&!ownerPasswordCrypto_.truncates(password),OWNER_PASSWORD_ERROR);
  must_(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(requestId||''),'Reload the sign-in page and try again.');
  const verifier=ownerPasswordHash_(),passwordTag=hash_(verifier);
  // Reserve attempts before expensive hashing; both entry points share this guard.
  locked_(()=>{
    const now=Date.now(),properties=props_();let guard=JSON.parse(properties.getProperty('OWNER_PASSWORD_GUARD')||'null');
    if(!guard||guard.until<=now||guard.passwordTag!==passwordTag)guard={until:now+15*60000,attempts:0,passwordTag};
    must_(guard.attempts<8,'Too many club sign-in attempts. Try again in '+Math.ceil((guard.until-now)/60000)+' minutes.');
    guard.attempts++;properties.setProperty('OWNER_PASSWORD_GUARD',JSON.stringify(guard));
  },false);
  // Password work must not hold the payment and gate write lock.
  must_(ownerPasswordCrypto_.compareSync(password,verifier),OWNER_PASSWORD_ERROR);
  return locked_(()=>{
    must_(ownerSignInMode_()==='password'&&ownerPasswordHash_()===verifier,OWNER_PASSWORD_ERROR);
    const current=eventIdentity_(identity.email);
    must_(current?.scope==='owner-entry'&&current.id===identity.id,OWNER_PASSWORD_ERROR);
    const now=Date.now(),properties=props_();authCleanup_(now);
    properties.deleteProperty('OWNER_PASSWORD_GUARD');
    const type=transfer?'desk-transfer':'staff',prefix=transfer?'h':current.id;
    const token=prefix+'.'+mac_('owner-password:'+passwordTag+':'+current.id+':'+type+':'+requestId);
    const existing=authSession_(token,type),expires=existing?.expires||now+(transfer?2*60000:8*3600000);
    if(!existing)properties.setProperty('AUTH_SESSION_'+hash_(token),JSON.stringify({type,staffId:current.id,role:'admin',passwordTag,expires}));
    return {token,expires,role:'admin',label:current.email};
  },false);
}
function signInClubWithPassword(email,password,requestId){
  const identity=emailAddress_(email)===clubOwner_()?eventIdentity_(email):null;
  const base=deskBaseUrl_();must_(base,'The desk link is unavailable. Open the private club desk link.');
  const transfer=ownerPasswordSession_(identity,password,requestId,true);
  return {continueUrl:staffDeskLink_(base,identity.row[2])+'&entry=verified#ticket='+transfer.token};
}
function signInOwnerWithPassword(invite,password,requestId){
  return ownerPasswordSession_(ownerIdentity_(invite),password,requestId,false);
}
