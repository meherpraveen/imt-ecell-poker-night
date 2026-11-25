const {readFileSync} = require('node:fs');
const path = require('node:path');

// These three filenames are also used by the club's existing deployment tooling.
const bundles = {
  Code: ['Pricing', 'Code', 'Directory', 'Journal', 'StaffAccess', 'Registration',
    'Receivers', 'ReceiptAmounts', 'PaymentProof', 'Statements', 'Reconcile', 'Desk', 'Tickets'],
  Auth: ['Auth', 'StudentSignIn', 'OwnerPassword'],
  Floor: ['Floor']
};

function readServerSource(bundle) {
  let source=bundles[bundle].map(name =>
    readFileSync(path.join(__dirname, '../gas', name + '.gs'), 'utf8')
  ).join('\n');
  if(bundle==='Auth'){
    // Verification uses an existing salt; no browser or Node randomness is needed in Apps Script.
    const bcrypt=readFileSync(require.resolve('bcryptjs'),'utf8');
    source+='\nconst ownerPasswordCrypto_=(function(){const module={exports:{}},exports=module.exports;const require=()=>({});const setTimeout=()=>{throw Error("Use synchronous password verification.")};\n'+bcrypt+'\nreturn module.exports;})();\n';
  }
  return source;
}

module.exports = {readServerSource};
