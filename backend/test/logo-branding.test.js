const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative));

function pngMetadata(relative) {
  const source = read(relative);
  assert.deepEqual([...source.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(source.toString('ascii', 12, 16), 'IHDR');
  return {
    width: source.readUInt32BE(16),
    height: source.readUInt32BE(20),
    bitDepth: source[24],
    colorType: source[25],
  };
}

function icoSizes(relative) {
  const source = read(relative);
  assert.equal(source.readUInt16LE(0), 0);
  assert.equal(source.readUInt16LE(2), 1);
  const count = source.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + (index * 16);
    const width = source[offset] || 256;
    const height = source[offset + 1] || 256;
    return `${width}x${height}`;
  }).sort();
}

test('canonical Lumi5 mark is a safe flat-purple vector', () => {
  const source = read('images/lumi5-mark.svg').toString('utf8');
  assert.match(source, /<svg[^>]*viewBox="0 0 100 100"/);
  assert.equal((source.match(/fill="#6B4EE6"/g) || []).length, 4);
  assert.equal((source.match(/<(?:path|circle)\b/g) || []).length, 4);
  assert.doesNotMatch(
    source,
    /<(?:script|image|foreignObject|linearGradient|radialGradient|filter|mask)\b|(?:href|xlink:href)=|<style\b|\bstroke=/i,
  );
});

test('Lumi5 raster and platform icons have exact production formats', () => {
  assert.deepEqual(
    pngMetadata('images/lumi5-mark-1024.png'),
    { width: 1024, height: 1024, bitDepth: 8, colorType: 6 },
  );
  assert.deepEqual(
    pngMetadata('favicon-32x32.png'),
    { width: 32, height: 32, bitDepth: 8, colorType: 2 },
  );
  assert.deepEqual(
    pngMetadata('apple-touch-icon.png'),
    { width: 180, height: 180, bitDepth: 8, colorType: 2 },
  );
  assert.deepEqual(icoSizes('favicon.ico'), ['16x16', '32x32', '48x48']);

  const favicon = read('favicon.svg').toString('utf8');
  assert.match(favicon, /<svg[^>]*viewBox="10 10 80 80"/);
  assert.match(favicon, /fill="#FFFFFF"/);
  assert.match(favicon, /fill="#6B4EE6"/);
  assert.doesNotMatch(favicon, /<(?:script|image|foreignObject|filter)\b|https?:\/\//i);
});
