// Digest composition — shared between the service worker (daily notification)
// and the page (tests). Classic script: defines globals, no imports.

// Parse a Firestore REST document into a plain task object.
function parseFsDoc(doc){
  const val = (x) => {
    if (x == null) return null;
    if ('stringValue' in x) return x.stringValue;
    if ('booleanValue' in x) return x.booleanValue;
    if ('integerValue' in x) return parseInt(x.integerValue, 10);
    if ('doubleValue' in x) return x.doubleValue;
    if ('arrayValue' in x) return (x.arrayValue.values || []).map(val);
    return null;
  };
  const out = {};
  const f = doc.fields || {};
  for (const k in f) out[k] = val(f[k]);
  out.id = String(doc.name || '').split('/').pop();
  return out;
}

// Build the digest summary for one member.
function composeDigest(items, me, sinceTs, todayStr){
  me = (me || '').toLowerCase();
  const visible = t => {
    const a = t.assignees || [];
    if (!a.length || !me) return true;
    return a.includes(me) || (t.createdBy || '').toLowerCase() === me;
  };
  const mine = items.filter(visible);
  const tomorrowStr = new Date(new Date(todayStr + 'T00:00:00Z').getTime() + 86400000)
    .toISOString().slice(0, 10);
  const openToday = mine.filter(t => !t.done && t.date === todayStr).length;
  const dueTomorrow = mine.filter(t => !t.done && t.date === tomorrowStr).length;
  const news = mine.filter(t => (t.createdAt || 0) > sinceTs && (t.createdBy || '').toLowerCase() !== me);
  const ticks = mine.filter(t => t.done && (t.doneAt || 0) > sinceTs && (t.doneBy || '').toLowerCase() !== me);
  let body = openToday + ' task' + (openToday === 1 ? '' : 's') + ' open today';
  if (dueTomorrow) body += ' · ' + dueTomorrow + ' due tomorrow';
  if (news.length) body += ' · ' + news.length + ' new from the family';
  if (ticks.length) body += ' · ' + ticks.length + ' ticked off';
  return {title: 'Idea → Todo', body, openToday, dueTomorrow, news, ticks};
}
