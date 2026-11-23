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
  return {scope:'player', id:matches[0], email};
}

function ownerIdentity_(invite) {
  const row = invitedStaff_(invite), owner = clubOwner_();
  must_(owner && row && row[1] === 'admin' && emailAddress_(row[0]) === owner, 'Open the owner’s private desk link from the club Sheet.');
  return {scope:'owner', id:hash_(row[2]).slice(0,24), email:owner, row};
}

function authCleanup_(now) {
  const properties = props_();
  if (Number(properties.getProperty('AUTH_CLEAN_AFTER')) > now) return;
  const values = properties.getProperties();
  Object.keys(values).filter(key => key.startsWith('AUTH_CODE_') || key.startsWith('AUTH_SESSION_')).forEach(key => {
    if (JSON.parse(values[key]).expires <= now) properties.deleteProperty(key);
  });
  properties.setProperty('AUTH_CLEAN_AFTER', String(now + AUTH_DAY));
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

function sendLoginCode_(identity, owner) {
  return locked_(() => {
    const now = Date.now(), properties = props_();
    authCleanup_(now);
    const quota = MailApp.getRemainingDailyQuota();
    must_(quota > (owner ? 0 : 1), 'Email sign-in has reached its sending limit. Try again later or contact E-Cell with your college ID.');
    const reply = {resendAfter:CODE_RESEND / 1000};
    if (!identity) return reply;
    const key = challengeKey_(identity);
    let state = JSON.parse(properties.getProperty(key) || 'null');
    if (!state) state = {lastSent:0};
    if (!state.windowEnd || state.windowEnd <= now) {
      state.sends = 0;
      state.windowEnd = now + AUTH_DAY;
    }
    // The same response applies to unknown accounts, cooldowns and exhausted requests.
    if (now - state.lastSent < CODE_RESEND || state.sends >= 5 || (state.failures >= 5 && state.codeUntil > now)) return reply;
    const nonce = rand_(), code = codeFor_(key, nonce);
    const purpose = owner ? 'sign in to the E-Cell admin desk' : 'sign in to Poker Night';
    try {
      MailApp.sendEmail(identity.email, 'Your E-Cell Poker Night sign-in code',
        'Enter ' + code + ' to ' + purpose + '. This code expires in 10 minutes and works once.\n\n' +
        'This is a sign-in code. Your venue entry pass is issued after payment verification.\n\n' +
        'If you did not request this message, you can ignore it.');
    } catch {
      must_(false, 'Email delivery is temporarily unavailable. Try sending the code again in a minute.');
    }
    properties.setProperty(key, JSON.stringify({...state, sends:state.sends+1, lastSent:now, nonce,
      verifier:mac_('login-check:' + key + ':' + nonce + ':' + code), failures:0, codeUntil:now+CODE_LIFETIME, expires:Math.max(state.windowEnd,now+CODE_LIFETIME)}));
    return reply;
  });
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

function verifyPlayerCode(identifier, code) {
  return locked_(() => {
    const identity = playerIdentity_(identifier);
    consumeLoginCode_(identity, code);
    return newSession_('player', 'p', {roll:identity.id, emailTag:mac_('mail:' + identity.email)}, 7 * AUTH_DAY);
  });
}

function playerRoll_(token) {
  const session = authSession_(token, 'player');
  must_(session, PLAYER_SIGN_IN);
  const email = emailAddress_(roster_()[session.roll]?.email);
  must_(email && session.emailTag === mac_('mail:' + email), PLAYER_SIGN_IN);
  return session.roll;
}

function playerLogout(token) { return endSession_(token, 'player'); }

function requestOwnerCode(invite) { return sendLoginCode_(ownerIdentity_(invite), true); }

function verifyOwnerCode(invite, code) {
  return locked_(() => {
    const owner = ownerIdentity_(invite);
    consumeLoginCode_(owner, code);
    return staffSession_(owner.row);
  });
}

function staffSession_(row) {
  const staffId = hash_(row[2]).slice(0,24);
  const session = newSession_('staff', staffId, {staffId, role:row[1]}, 8 * 3600000);
  return {...session, role:row[1], label:row[0]};
}

function staffLogout(token) { return endSession_(token, 'staff'); }
