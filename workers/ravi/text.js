export function text(value) {
  return String(value || '').trim();
}

export function parseMetadata(value) {
  try {
    const parsed = JSON.parse(text(value) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function isDebugOn() {
  return /^(1|true|yes)$/i.test(String(process.env.RAVI_DEBUG || ''));
}
