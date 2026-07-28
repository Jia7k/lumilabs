const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative));

const PAGE_BRAND_HREFS = new Map([
  ['about.html', 'index.html'],
  ['assignments.html', 'index.html'],
  ['audit-logs.html', 'index.html'],
  ['browse.html', 'investordashboard.html'],
  ['businessownerdashboard.html', 'index.html'],
  ['contact.html', 'index.html'],
  ['createportfolio.html', 'index.html'],
  ['index.html', 'index.html'],
  ['investordashboard.html', 'investordashboard.html'],
  ['messages.html', 'index.html'],
  ['moderatordashboard.html', 'index.html'],
  ['my-interests.html', 'investordashboard.html'],
  ['mybusinesses.html', 'index.html'],
  ['relationshipmanagerdashboard.html', 'index.html'],
  ['signin.html', 'index.html'],
  ['signup.html', 'index.html'],
  ['superadmindashboard.html', 'index.html'],
]);

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1];
}

function brandAnchors(source) {
  return [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((match) => {
      const classes = attribute(match[1], 'class')?.split(/\s+/) || [];
      return classes.some((name) => ['landing-brand', 'auth-brand', 'nav-logo'].includes(name));
    });
}

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

test('all 17 pages use the approved accessible Lumi5 mark and platform icons', () => {
  assert.deepEqual(
    [...PAGE_BRAND_HREFS.keys()],
    fs.readdirSync(root).filter((name) => name.endsWith('.html')).sort(),
  );

  for (const [page, expectedHref] of PAGE_BRAND_HREFS) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const anchors = brandAnchors(source);
    assert.equal(anchors.length, 1, `${page}: one brand link`);
    assert.equal(attribute(anchors[0][1], 'href'), expectedHref, `${page}: preserved destination`);
    assert.match(anchors[0][2].replace(/<[^>]+>/g, ' '), /\bLumi5 Labs\b/);

    const images = [...anchors[0][2].matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    assert.equal(images.length, 1, `${page}: one mark image`);
    assert.equal(attribute(images[0], 'src'), 'images/lumi5-mark.svg');
    assert.equal(attribute(images[0], 'alt'), '');
    assert.equal(attribute(images[0], 'width'), '24');
    assert.equal(attribute(images[0], 'height'), '24');
    assert.doesNotMatch(anchors[0][2], /<svg\b|ti-trending-up/);

    for (const expected of [
      /<link\b[^>]*rel=["']icon["'][^>]*href=["']favicon\.ico["'][^>]*>/i,
      /<link\b[^>]*rel=["']icon["'][^>]*href=["']favicon\.svg["'][^>]*type=["']image\/svg\+xml["'][^>]*>/i,
      /<link\b[^>]*rel=["']icon["'][^>]*href=["']favicon-32x32\.png["'][^>]*sizes=["']32x32["'][^>]*>/i,
      /<link\b[^>]*rel=["']apple-touch-icon["'][^>]*href=["']apple-touch-icon\.png["'][^>]*>/i,
    ]) {
      assert.match(source, expected, `${page}: platform icon`);
    }
  }

  const business = fs.readFileSync(path.join(root, 'businessownerdashboard.html'), 'utf8');
  assert.equal((business.match(/ti ti-trending-up/g) || []).length, 1);
});
