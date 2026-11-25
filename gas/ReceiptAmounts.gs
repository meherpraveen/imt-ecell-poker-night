// Receipt amounts come from payment labels, currency, or recognizable receipt
// summaries. Rewards and balances are excluded before comparing candidates.
function screenshotAmount_(text){
  const lines=String(text).split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!/^[:|·•]+$/.test(line));
  const values=new Set();let conflict=false;
  const unrelated=/\b(?:cash\s*back|rewards?|earned?|earning|won|win|scratch|balance|discount|savings?|offers?|up\s*to|upto|fees?|charges?|tax|gst)\b/i;
  const label=/^(?:amount(?:\s+paid)?|paid\s+amount|total(?:\s+paid)?|payment\s+amount|transfer\s+amount|you\s+paid)\s*[:=-]?$/i;
  const standalone=line=>{
    const match=/^(?:₹|INR\b|Rs\.?|[$*])?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*\/-)?$/i.exec(line||'');
    return match?paise_(match[1]):null;
  };
  const excluded=index=>unrelated.test(lines[index])||
    (index>0&&unrelated.test(lines[index-1])&&!/\d/.test(lines[index-1])&&!label.test(lines[index-1]));
  const add=value=>{if(value!==null)values.add(value)};
  for(let i=0;i<lines.length;i++){
    const line=lines[i],previous=lines[i-1]||'',next=lines[i+1]||'';
    if(excluded(i))continue;
    // Capture the entire numeric token. Partial digits from a time, identifier,
    // percentage or malformed amount must never become an amount.
    for(const match of line.matchAll(/(?:₹|\bINR\b|\bRs\.?)[ \t]*(\S+)/gi)){
      const tail=line.slice(match.index+match[0].length);
      if(/^[ \t]+\d/.test(tail))continue;
      add(paise_(match[1].replace(/\/-$/,'')));
    }
    if(/^(?:₹|INR|Rs\.?)$/i.test(previous)&&!excluded(i-1))add(standalone(line));
    const written=/^(?:Rupees\s+(.+?)|(.+?)\s+Rupees)(?:\s+Only)?$/i.exec(line);
    if(written){
      const words=receiptRupeesInWords_((written[1]||written[2]).replace(/\s+only$/i,'')),numeric=standalone(previous);
      if(words!==null&&numeric!==null&&!excluded(i-1)){
        if(words===numeric)add(words);else conflict=true;
      }
    }
    const numeric=standalone(line);
    // A lone digit without currency or matching words may be a navigation icon.
    if(numeric===null||!/\d{2}|\d\.\d/.test(line))continue;
    const labelled=label.test(previous)||/^paid\s+to\b/i.test(next);
    const googleSummary=/^to\s*:?[ \t]+\S/i.test(previous)&&/^pay again$/i.test(next)&&/^completed$/i.test(lines[i+2]||'');
    const paytmSummary=/\bUPI\s*ID\s*:/i.test(previous)&&/@/.test(previous)&&/\bRef\.?\s*No\b/i.test(next)&&/\b\d{1,2}\s+[a-z]{3}\b/i.test(next);
    const superMoneySummary=lines.slice(0,i).some(s=>/^super\.?\s*money$/i.test(s))&&/\bRef\s*ID\s*:/i.test(lines[i+2]||'')&&/\bat\s+\d{1,2}:\d{2}\s*[ap]m\b/i.test(lines[i+2]||'');
    if(labelled||googleSummary||paytmSummary||superMoneySummary)add(numeric);
  }
  // PhonePe shows the paid and debited amounts separately. Corroborate both
  // occurrences when OCR loses their glyphs. A one-digit icon is insufficient.
  if(lines.some(line=>/^PhonePe Transaction ID$/i.test(line))&&lines.some(line=>/^Debited from$/i.test(line))){
    const start=lines.findIndex(line=>/^Paid to$/i.test(line)),repeated=new Map();
    for(let i=start+1;start>=0&&i<lines.length;i++){
      if(/^(?:send again|view history|share receipt|contact PhonePe)/i.test(lines[i]))break;
      if(excluded(i)||!/^(?:[₹$*]\s*)?\d{2,9}(?:\.\d{1,2})?$/.test(lines[i]))continue;
      const amount=standalone(lines[i]);if(amount!==null)repeated.set(amount,(repeated.get(amount)||0)+1);
    }
    for(const [amount,count] of repeated)if(count>=2)add(amount);
  }
  return !conflict&&values.size===1?([...values][0]/100).toFixed(2):'';
}
