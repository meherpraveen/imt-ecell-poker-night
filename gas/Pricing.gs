// Shared by Apps Script and the public pages. The cutoff includes the event's UTC offset.
const ENTRY_PRICING = Object.freeze({
  currency: 'INR',
  standard: 199,
  earlyBird: 149,
  retry: 149,
  earlyBirdEndsAt: '2026-11-27T19:00:00+05:30'
});

function entryOffer_(now, kind) {
  const endsAt = Date.parse(ENTRY_PRICING.earlyBirdEndsAt);
  const early = kind !== 'retry' && now < endsAt;
  const amount = kind === 'retry' ? ENTRY_PRICING.retry : early ? ENTRY_PRICING.earlyBird : ENTRY_PRICING.standard;
  return {amount, early, endsAt, standard: ENTRY_PRICING.standard, currency: ENTRY_PRICING.currency, now};
}

function formatFee_(amount, currency = ENTRY_PRICING.currency) {
  return new Intl.NumberFormat('en-IN', {style: 'currency', currency, maximumFractionDigits: 0}).format(amount);
}
