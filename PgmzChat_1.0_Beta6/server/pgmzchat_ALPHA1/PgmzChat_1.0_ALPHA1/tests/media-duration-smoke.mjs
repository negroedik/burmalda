import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'client/app.js'), 'utf8');
const start = source.indexOf('const formatDuration = value => {');
const end = source.indexOf('const dateKey =', start);
if (start < 0 || end < 0) throw new Error('Could not locate duration helpers in client/app.js');
const helperSource = source.slice(start, end);
const helpers = new Function('MAX_VOICE_SECONDS', 'MAX_CIRCLE_SECONDS', `${helperSource}; return { formatDuration, cleanDuration, trustedMediaDuration };`)(180, 60);
const assert = (ok, message) => {
  if (!ok) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};
assert(helpers.formatDuration(6) === '0:06', 'six-second duration formats as 0:06');
assert(helpers.formatDuration(2820) === '47:00', 'duration formatter handles 47-minute values without NaN');
assert(helpers.cleanDuration(2820, 'circle') === 0, 'invalid circle duration metadata is discarded rather than capped misleadingly');
assert(helpers.cleanDuration(2820, 'voice') === 0, 'invalid voice duration metadata is discarded rather than capped misleadingly');
assert(helpers.trustedMediaDuration(2820, 6, 'circle') === 6, 'bad 47-minute WebView metadata cannot replace a recorded six-second video-note duration');
assert(helpers.trustedMediaDuration(6, 2820, 'circle') === 6, 'valid six-second media metadata repairs an impossible legacy stored duration');
assert(helpers.trustedMediaDuration(Number.NaN, 6, 'voice') === 6, 'missing audio metadata falls back to recorded duration');
assert(helpers.trustedMediaDuration(6, 0, 'circle') === 6, 'valid metadata is used when a legacy message has no stored duration');
console.log('All media duration smoke tests passed.');
