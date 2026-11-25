// Temporary registration access while the club's mail quota is exhausted.
// Set to 'email' and rebuild/redeploy to restore student email verification.
const STUDENT_SIGN_IN_MODE='directory';
function studentSignInMode_(){
  const configured=typeof CLUB_RESOURCES==='object'&&CLUB_RESOURCES.studentSignIn;
  return (configured||STUDENT_SIGN_IN_MODE)==='directory'?'directory':'email';
}
function signInWithStudentDetails(roll,email,preferred,requestId){
  must_(studentSignInMode_()==='directory','Student email verification is active. Reload the sign-in page.');
  roll=String(roll||'').trim();email=emailAddress_(email);
  const mismatch='The roll number and college email must match one student record. Check both details or contact E-Cell.';
  must_(/^\d{9}$/.test(roll)&&email,mismatch);
  must_(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(requestId||''),'Reload the sign-in page and try again.');
  const identity=playerIdentity_(roll);
  must_(identity&&identity.email===email&&email!==clubOwner_(),mismatch);
  const session=locked_(()=>{
    authCleanup_(Date.now());
    // The request nonce makes a retry recover the same session after a lost reply.
    const token='p.'+mac_('directory-login:'+roll+':'+email+':'+requestId),existing=authSession_(token,'player');
    if(existing)return {token,expires:existing.expires};
    const expires=Date.now()+STUDENT_SESSION_LIFETIME;
    props_().setProperty('AUTH_SESSION_'+hash_(token),JSON.stringify({type:'player',roll,emailTag:mac_('mail:'+email),remembered:true,method:'directory',expires}));
    return {token,expires};
  },false);
  try{return {session,account:accountForRoll_(roll,preferred,identity.person)}}
  catch{return {session,account:null}}
}
