const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'messages.html'),
  'utf8'
);

function firstRule(selector) {
  const escaped = selector.replaceAll('.', '\\.');
  const match = html.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, 'Expected CSS rule for ' + selector);
  return match[1];
}

test('thread grid keeps the composer inside the clipped shell', () => {
  const thread = firstRule('.thread-panel');
  assert.match(thread, /min-height:\s*0\s*;/);
  assert.match(thread, /overflow:\s*hidden\s*;/);
  assert.match(
    thread,
    /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s*;/
  );
});

test('message history is the only shrinking scroll row', () => {
  const history = firstRule('.message-list');
  assert.match(history, /min-height:\s*0\s*;/);
  assert.match(history, /overflow-y:\s*auto\s*;/);
});

test('narrow layout gives the thread a bounded height', () => {
  const match = html.match(
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.thread-panel\s*\{([^}]*)\}/
  );
  assert.ok(match, 'Expected narrow-screen thread-panel rule');
  assert.match(match[1], /height:\s*560px\s*;/);
  assert.match(match[1], /min-height:\s*0\s*;/);
});

test('participant rail and archive notice remain inside the fixed thread shell', () => {
  assert.match(html, /id="thread-participants"/);
  assert.match(html, /class="composer-zone"[\s\S]*id="archive-notice"[\s\S]*id="message-form"/);
  assert.match(firstRule('.composer-zone'), /border-top:\s*1px solid var\(--border\)/);
});

test('message thread and composer use shrinkable explicit columns', () => {
  assert.match(
    firstRule('.thread-panel'),
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
  );
  assert.match(firstRule('.thread-header'), /min-width:\s*0\s*;/);
  assert.match(firstRule('.message-list'), /min-width:\s*0\s*;/);
  assert.match(firstRule('.composer-zone'), /min-width:\s*0\s*;/);
  const composer = firstRule('.compose-form');
  assert.match(composer, /min-width:\s*0\s*;/);
  assert.match(
    composer,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s*;/,
  );
  const input = firstRule('.compose-input');
  assert.match(input, /min-width:\s*0\s*;/);
  assert.match(input, /width:\s*100%\s*;/);
  assert.match(firstRule('.message-bubble'), /overflow-wrap:\s*anywhere\s*;/);
});

test('narrow message shell uses a shrinkable single column', () => {
  const match = html.match(
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.messaging-shell\s*\{([^}]*)\}/,
  );
  assert.ok(match);
  assert.match(
    match[1],
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
  );
});
