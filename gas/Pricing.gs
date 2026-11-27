// Server-owned entry pricing. The cutoff includes the event's UTC offset.
const ENTRY_PRICING = Object.freeze({
  currency: 'INR',
  standard: 199,
  earlyBird: 149,
  retry: 149,
  earlyBirdEndsAt: '2026-11-27T16:00:00+05:30'
});
const ONLINE_REGISTRATION = Object.freeze({
  closesAt: '2026-11-27T16:00:00+05:30',
  deskOpensAt: '2026-11-27T19:00:00+05:30',
  venue: 'Amphitheater'
});

function entryOffer_(now, kind) {
  const endsAt = Date.parse(ENTRY_PRICING.earlyBirdEndsAt);
  const early = kind !== 'retry' && now < endsAt;
  const amount = kind === 'retry' ? ENTRY_PRICING.retry : early ? ENTRY_PRICING.earlyBird : ENTRY_PRICING.standard;
  return {amount, early, endsAt, standard: ENTRY_PRICING.standard, currency: ENTRY_PRICING.currency, now,
    registrationClosesAt:Date.parse(ONLINE_REGISTRATION.closesAt),deskOpensAt:Date.parse(ONLINE_REGISTRATION.deskOpensAt),venue:ONLINE_REGISTRATION.venue};
}

function formatFee_(amount, currency = ENTRY_PRICING.currency) {
  return new Intl.NumberFormat('en-IN', {style: 'currency', currency, maximumFractionDigits: 0}).format(amount);
}
