import assert from 'node:assert/strict';
import { canonicalMediaMime, normalizeMediaDataUrl } from '../client/media-utils.js';

const payload = 'QUFBQQ==';
const malformed = `data:video/webm;codecs=vp8,opus;base64,${payload}`;
const repaired = normalizeMediaDataUrl(malformed, 'video/webm');
assert.equal(repaired, `data:video/webm;base64,${payload}`, 'codec comma must be removed from Data URL metadata while preserving payload');
assert.equal(repaired.indexOf(','), 'data:video/webm;base64,'.length - 1, 'only the true Data URL separator remains');
assert.equal(normalizeMediaDataUrl('data:image/png;base64,iVBORw0KGgo=', 'image/png'), 'data:image/png;base64,iVBORw0KGgo=');
assert.equal(canonicalMediaMime('video/webm;codecs=vp8,opus', 'video/mp4'), 'video/webm');
assert.equal(canonicalMediaMime('audio/mp4;codecs=mp4a.40.2', 'audio/webm'), 'audio/mp4');

// Exercise the platform's actual Data URL parser. The malformed URL is not
// interpreted as Base64 because its first comma occurs inside the codec label.
const brokenResponse = await fetch(malformed);
assert.equal(brokenResponse.headers.get('content-type'), 'video/webm;codecs=vp8');
assert.equal(await brokenResponse.text(), `opus;base64,${payload}`);
const repairedResponse = await fetch(repaired);
assert.equal(repairedResponse.headers.get('content-type'), 'video/webm');
assert.equal(await repairedResponse.text(), 'AAAA');
assert.equal(normalizeMediaDataUrl('https://example.invalid/circle.webm', 'video/webm'), 'https://example.invalid/circle.webm');
assert.equal(normalizeMediaDataUrl('blob:https://pgmz.local/123', 'video/webm'), 'blob:https://pgmz.local/123');
console.log('PASS: runtime Data URL parsing reproduces the broken MIME-comma payload and the corrected binary payload');
console.log('PASS: comma-containing codec MIME types are normalized into valid Data URLs');
console.log('PASS: legacy video Data URLs are repaired without altering base64 payload');
console.log('PASS: image Data URLs and non-Data URLs remain valid');
