// Small pure helpers shared by the app and the Node regression tests.
export function canonicalMediaMime(value, fallback = 'application/octet-stream') {
  const raw = String(value || '').trim().toLowerCase();
  const essence = raw.split(';', 1)[0].trim();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence) ? essence : fallback;
}

/**
 * Older builds could produce e.g. data:video/webm;codecs=vp8,opus;base64,...
 * The comma inside `codecs` is parsed as the Data URL separator by WebViews.
 * Locate the *actual* `;base64,` marker from the right, then rebuild a canonical
 * URL using only the MIME essence. This repairs legacy messages without changing
 * the encoded media bytes. Non-base64 and network/blob URLs are left untouched.
 */
export function normalizeMediaDataUrl(value, fallback = 'application/octet-stream') {
  if (typeof value !== 'string' || !/^data:/i.test(value)) return value;
  const marker = value.lastIndexOf(';base64,');
  if (marker < 5) return value;
  const rawMime = value.slice(5, marker);
  const mime = canonicalMediaMime(rawMime, fallback);
  const payload = value.slice(marker + ';base64,'.length);
  if (!payload || /[^A-Za-z0-9+/=]/.test(payload)) return value;
  return `data:${mime};base64,${payload}`;
}
