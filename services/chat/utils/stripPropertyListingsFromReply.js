/** Remove property listing prose when the widget shows match cards instead. */

function isListingBulletLine(value) {
  const s = String(value || '')
    .trim()
    .replace(/^_+/, '')
    .trim();
  if (!/^[-*•]\s+/.test(s)) return false;
  const lower = s.toLowerCase();
  return (
    /\$[\d,]/.test(s) ||
    /\b(bed|bath|bedroom|bathroom|price|pool|kitchen|budget|property type|match|features?)\b/i.test(
      lower
    )
  );
}

function isNumberedPropertyLine(value) {
  const s = String(value || '').trim();
  if (!/^\d+\.\s+/.test(s)) return false;
  const lower = s.toLowerCase();
  return /\b(home|house|property|condo|townhouse|listing|lahore|family)\b/i.test(lower);
}

function isLeadRecapBullet(value) {
  const s = String(value || '').trim();
  return /^\s*[-*•]\s+\*\*[^*]+:\*\*/.test(s);
}

function isPropertyMatchIntroLine(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return false;
  return (
    /^here are (some )?(properties|listings|matches|homes|options)/.test(s) ||
    /^i['']?m pulling up property matches/.test(s) ||
    /^please hold on/.test(s) ||
    /^matched options include/.test(s) ||
    /^let me (pull|find|show)/.test(s)
  );
}

export function stripPropertyListingsFromReply(text) {
  const raw = String(text || '');
  if (!raw.trim()) return '';

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = String(lines[i] || '');
    const trimmed = line.trim();

    if (!trimmed) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      i += 1;
      continue;
    }

    if (isPropertyMatchIntroLine(trimmed)) {
      i += 1;
      continue;
    }

    if (isNumberedPropertyLine(trimmed)) {
      i += 1;
      while (i < lines.length) {
        const next = String(lines[i] || '').trim();
        if (!next) break;
        if (isNumberedPropertyLine(next)) break;
        i += 1;
      }
      continue;
    }

    if (/^matched options include\s*:/i.test(trimmed)) {
      i += 1;
      while (i < lines.length && (!String(lines[i] || '').trim() || isListingBulletLine(lines[i]))) {
        i += 1;
      }
      continue;
    }

    if (isListingBulletLine(trimmed) || isLeadRecapBullet(trimmed)) {
      i += 1;
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
