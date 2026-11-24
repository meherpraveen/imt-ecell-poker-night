const CODE_LIFETIME = 10 * 60000;
const CODE_RESEND = 60000;
const AUTH_DAY = 24 * 3600000;
const PLAYER_SIGN_IN = 'Sign in with your registered email to continue.';
const STAFF_SIGN_IN = 'Sign in to the staff desk again.';
const CODE_ERROR = 'That code is incorrect or has expired. Check the latest email or request a new code.';

function emailAddress_(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) ? email : '';
}

function clubOwner_() {
  const configured = typeof CLUB_RESOURCES === 'object' && CLUB_RESOURCES.owner;
  return emailAddress_(configured || props_().getProperty('EVENT_OWNER'));
}

function playerIdentity_(identifier) {
  const input = String(identifier || '').trim();
  const byRoll = /^\d{9}$/.test(input);
  must_(byRoll || emailAddress_(input), 'Enter your nine-digit roll number or your registered email address.');
  const people = roster_();
  const email = emailAddress_(byRoll ? people[input]?.email : input);
  if (!email) return null;
  const matches = Object.keys(people).filter(roll => emailAddress_(people[roll].email) === email);
  if (matches.length !== 1) return null;
  return {scope:'player', id:matches[0], email, person:people[matches[0]]};
}

function ownerIdentity_(invite) {
  const row = invitedStaff_(invite), owner = clubOwner_();
  must_(owner && row && row[1] === 'admin' && emailAddress_(row[0]) === owner, 'Open the owner’s private desk link from the club Sheet.');
  return {scope:'owner', id:hash_(row[2]).slice(0,24), email:owner, row};
}

function eventIdentity_(identifier) {
  const email = emailAddress_(identifier);
  if (!email || email !== clubOwner_()) return playerIdentity_(identifier);
  const rows = staffList_().filter(row => row[1] === 'admin' && activeStaff_(row));
  if (rows.length !== 1) return null;
  return {scope:'owner-entry', id:hash_(rows[0][2]).slice(0,24), email, row:rows[0]};
}

function authCleanup_(now) {
  const properties = props_();
  if (Number(properties.getProperty('AUTH_CLEAN_AFTER')) > now) return;
  const values = properties.getProperties();
  const expired=Object.keys(values).filter(key=>(key.startsWith('AUTH_CODE_')||key.startsWith('AUTH_SESSION_'))&&JSON.parse(values[key]).expires<=now);
  for(const key of expired.slice(0,8))properties.deleteProperty(key);
  properties.setProperty('AUTH_CLEAN_AFTER',String(now+(expired.length>8?60000:AUTH_DAY)));
}

function challengeKey_(identity) {
  return 'AUTH_CODE_' + mac_([identity.scope, identity.id, identity.email].join('|'));
}

function codeFor_(key, nonce) {
  const bytes = Utilities.computeHmacSha256Signature('login-digits:' + key + ':' + nonce, props_().getProperty('KEY'));
  const value = bytes.slice(0,4).reduce((n, b) => n * 256 + (b & 255), 0);
  return String(value % 1000000).padStart(6, '0');
}

function equalDigest_(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

// Track reservations while Google is accepting mail, so that delivery never holds the gate's write lock.
function pendingMail_(now) {
  const slots = JSON.parse(props_().getProperty('MAIL_IN_FLIGHT') || '{}');
  for (const ref of Object.keys(slots)) if (slots[ref] <= now) delete slots[ref];
  return slots;
}
function remainingMail_(slots) {
  return MailApp.getRemainingDailyQuota() - Object.keys(slots).length;
}

function planCode_(identity, owner) {
  const now = Date.now(), properties = props_();
  authCleanup_(now);
  const slots = pendingMail_(now);
  const available = remainingMail_(slots) > (owner ? 0 : 1);
  const limitMessage = 'Email sending has reached its daily limit. You can still enter an unexpired code. Otherwise try later or contact E-Cell.';
  if (!identity) {
    must_(available, limitMessage);
    return {wait:60, expiresIn:600};
  }
  const key = challengeKey_(identity), state = JSON.parse(properties.getProperty(key) || '{}');
  if (!state.windowEnd || state.windowEnd <= now) {state.windowEnd = now + AUTH_DAY; state.sends = 0}
  const remaining = Math.max(0,Math.ceil(((state.codeUntil || 0)-now)/1000));
  const active = !!state.verifier && remaining > 0;
  must_(!(remaining && state.failures >= 5), 'Too many incorrect codes. Request a new code in '+Math.ceil(remaining/60)+' minutes.');
  if (slots[state.pending]) return {wait:60, expiresIn:remaining || 600, delivery:'pending'};
  const cooldown = Math.ceil(((state.lastSent || 0) + CODE_RESEND-now)/1000);
  if (cooldown > 0) {
    must_(active, 'You recently used your code. Request another in '+cooldown+' seconds.');
    return {wait:cooldown, expiresIn:remaining, delivery:'existing'};
  }
  if(state.sends>=5)must_(false,'This account has reached its sign-in email limit. Enter an unexpired code or try again in about '+Math.ceil((state.windowEnd-now)/3600000)+' hours.');
  must_(available, limitMessage);
  const ref = rand_().slice(0,16), nonce = active ? state.nonce : rand_();
  const code=codeFor_(key,nonce);
  slots[ref] = now + 180000;
  state.pending = ref;state.sends++;
  if(!active){
    // Save the verifier before mail leaves. A lost response cannot strand a delivered code.
    state.nonce=nonce;state.verifier=mac_('login-check:'+key+':'+nonce+':'+code);
    state.failures=0;state.codeUntil=now+CODE_LIFETIME;
  }
  state.expires = Math.max(state.windowEnd, now + CODE_LIFETIME);
  properties.setProperties({[key]:JSON.stringify(state),MAIL_IN_FLIGHT:JSON.stringify(slots)});
  return {key,ref,nonce,active,code};
}

function finishMail_(plan,accepted) {
  const properties=props_(), now=Date.now(), slots=pendingMail_(now);
  delete slots[plan.ref];
  const state=JSON.parse(properties.getProperty(plan.key) || '{}');
  if(state.pending!==plan.ref){properties.setProperty('MAIL_IN_FLIGHT',JSON.stringify(slots));return {wait:60,expiresIn:0,delivery:'superseded'}}
  delete state.pending;
  if(accepted){
    state.lastSent=now;
    // A resend never resets the guess limit or reinstates a code consumed during delivery.
    if(state.verifier && state.nonce===plan.nonce)state.codeUntil=now+CODE_LIFETIME;
    state.expires=Math.max(state.windowEnd,state.codeUntil || 0);
  }else{
    state.sends=Math.max(0,state.sends-1);
    if(!plan.active&&state.nonce===plan.nonce){delete state.verifier;delete state.nonce;state.codeUntil=0}
  }
  properties.setProperties({[plan.key]:JSON.stringify(state),MAIL_IN_FLIGHT:JSON.stringify(slots)});
  return {wait:60,expiresIn:Math.max(0,Math.ceil(((state.codeUntil || 0)-now)/1000)),delivery:accepted?'accepted':'failed'};
}

function sendLoginCode_(identity, owner, confirmed=false) {
  let result=locked_(()=>planCode_(identity,owner),false);
  if (result.ref) {
    const plan=result;
    let accepted=false;
    try {
      const eventAdmin = identity.scope === 'owner-entry';
      const kind = owner ? 'private desk ' : eventAdmin ? 'admin ' : '';
      const message = owner ? 'Enter this code on the private E-Cell desk page where you requested it.'
        : eventAdmin ? 'Enter this code on the event sign-in page where you entered the club email. It will open your admin desk.'
        : 'Enter this code on the Poké Poker Night registration page you opened.';
      sendEventMail_(identity.email, {
        subject:EVENT_MAIL_NAME+' '+kind+'sign-in code', heading:'Your '+kind+'sign-in code', message,
        code:plan.code, instructions:'This code works once and expires in 10 minutes. If you did not request it, you can ignore this email.'
      });
      accepted=true;
    } catch {
      console.warn('Poké Poker Night sign-in mail provider declined request '+plan.ref);
    }
    result=locked_(()=>finishMail_(plan,accepted),false);
    must_(accepted,'Email delivery is temporarily unavailable. Try again in a minute. An earlier unexpired code still works.');
  }
  const reply={resendAfter:result.wait,expiresIn:result.expiresIn};
  if(owner||confirmed)reply.delivery=result.delivery;
  return reply;
}

// Call while holding the script lock, including creation of the verified session.
function consumeLoginCode_(identity, code) {
  must_(typeof code === 'string' && /^\d{6}$/.test(code) && identity, CODE_ERROR);
  const key = challengeKey_(identity), properties = props_(), now = Date.now();
  const state = JSON.parse(properties.getProperty(key) || 'null');
  must_(state && state.verifier && state.codeUntil > now && state.failures < 5, CODE_ERROR);
  const supplied = mac_('login-check:' + key + ':' + state.nonce + ':' + code);
  if (!equalDigest_(state.verifier, supplied)) {
    state.failures++;
    properties.setProperty(key, JSON.stringify(state));
    must_(false, CODE_ERROR);
  }
  delete state.verifier;
  delete state.nonce;
  state.codeUntil = 0;
  properties.setProperty(key, JSON.stringify(state));
}

function newSession_(type, prefix, claims, lifetime) {
  const expires = Date.now() + lifetime;
  const token = prefix + '.' + mac_('new-session:' + type + ':' + rand_() + ':' + rand_());
  props_().setProperty('AUTH_SESSION_' + hash_(token), JSON.stringify({...claims, type, expires}));
  return {token, expires};
}

function authSession_(token, type) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,24}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const key = 'AUTH_SESSION_' + hash_(token), properties = props_();
  const session = JSON.parse(properties.getProperty(key) || 'null');
  if (!session || session.type !== type) return null;
  if (session.expires > Date.now()) return session;
  properties.deleteProperty(key);
  return null;
}

function endSession_(token, type) {
  if (authSession_(token, type)) props_().deleteProperty('AUTH_SESSION_' + hash_(token));
  return true;
}

function requestPlayerCode(identifier) {
  return sendLoginCode_(playerIdentity_(identifier), false);
}

function requestEventCode(identifier) {
  // Public requests share the ordinary mail budget. The private desk keeps its reserved send.
  return sendLoginCode_(eventIdentity_(identifier), false);
}

function requestMatchedPlayerCode(roll,email) {
  const identity=playerIdentity_(roll_(roll));
  must_(identity && emailAddress_(email)===identity.email,'That roll and email do not match one student record. E-Cell can check the registered address against your college ID.');
  return sendLoginCode_(identity,false,true);
}
function authenticatePlayer_(identity,code) {
  return locked_(() => {
    consumeLoginCode_(identity, code);
    return newSession_('player', 'p', {roll:identity.id, emailTag:mac_('mail:' + identity.email)}, 7 * AUTH_DAY);
  },false);
}
function verifyPlayerCode(identifier, code) {
  return authenticatePlayer_(playerIdentity_(identifier),code);
}
function signInPlayer(identifier,code,preferred) {
  return signedInPlayer_(playerIdentity_(identifier),code,preferred);
}
function signedInPlayer_(identity,code,preferred) {
  const session=authenticatePlayer_(identity,code);
  // A temporary checkout read failure must never consume the student's sign-in without returning the session.
  try { return {session,account:accountForRoll_(identity.id,preferred,identity.person)} }
  catch { return {session,account:null} }
}

function signInEvent(identifier,code,preferred) {
  const identity = eventIdentity_(identifier);
  if (identity?.scope !== 'owner-entry') return signedInPlayer_(identity,code,preferred);
  const base = deskBaseUrl_();
  must_(base, 'The desk link is unavailable. Open the Staff tab in the club Sheet.');
  return locked_(() => {
    consumeLoginCode_(identity,code);
    const transfer = newSession_('desk-transfer','h',{staffId:identity.id},2*60000);
    const desk = staffDeskLink_(base,identity.row[2]);
    return {continueUrl:desk+'&entry=verified#ticket='+transfer.token};
  },false);
}

function completeDeskSignIn(invite,ticket) {
  return locked_(() => {
    const owner = ownerIdentity_(invite);
    const transfer = authSession_(ticket,'desk-transfer');
    must_(transfer && transfer.staffId === owner.id, 'This sign-in link has expired or was already used. Send a new code to the club email here.');
    props_().deleteProperty('AUTH_SESSION_'+hash_(ticket));
    return staffSession_(owner.row);
  },false);
}

function playerDirectory_(token) {
  const session=authSession_(token,'player');must_(session,PLAYER_SIGN_IN);
  const person=directoryPlayer_(session.roll);
  const email=emailAddress_(person?.email);must_(email&&session.emailTag===mac_('mail:'+email),PLAYER_SIGN_IN);
  return {roll:session.roll,person};
}
function playerRoll_(token){return playerDirectory_(token).roll}

function playerLogout(token) { return endSession_(token, 'player'); }

function requestOwnerCode(invite) { return sendLoginCode_(ownerIdentity_(invite), true); }

function verifyOwnerCode(invite, code) {
  return locked_(() => {
    const owner = ownerIdentity_(invite);
    consumeLoginCode_(owner, code);
    return staffSession_(owner.row);
  },false);
}

function staffSession_(row) {
  const staffId = hash_(row[2]).slice(0,24);
  const session = newSession_('staff', staffId, {staffId, role:row[1]}, 8 * 3600000);
  return {...session, role:row[1], label:row[0]};
}

function staffLogout(token) { return endSession_(token, 'staff'); }
