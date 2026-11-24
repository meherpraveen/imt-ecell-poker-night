const {readFileSync} = require('node:fs');
const path = require('node:path');

// These three filenames are also used by the club's existing deployment tooling.
const bundles = {
  Code: ['Pricing', 'Code', 'Directory', 'Journal', 'StaffAccess', 'Registration',
    'Receivers', 'PaymentProof', 'Statements', 'Reconcile', 'Desk', 'Tickets'],
  Auth: ['Auth'],
  Floor: ['Floor']
};

function readServerSource(bundle) {
  return bundles[bundle].map(name =>
    readFileSync(path.join(__dirname, '../gas', name + '.gs'), 'utf8')
  ).join('\n');
}

module.exports = {readServerSource};
