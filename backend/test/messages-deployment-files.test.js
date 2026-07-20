const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deployDir = path.join(__dirname, '..', 'deploy');

test('systemd unit runs only the messaging entry point on the isolated runtime', () => {
  const service = fs.readFileSync(path.join(deployDir, 'lumilabs-messaging.service'), 'utf8');

  assert.match(
    service,
    /ExecStart=\/opt\/lumilabs-messaging\/current\/bin\/node \/var\/www\/html\/backend\/messages-server\.js/
  );
  assert.doesNotMatch(service, /\/var\/www\/html\/backend\/server\.js/);
  assert.match(service, /User=user/);
});

test('Apache config anchors the messaging namespace boundary', () => {
  const proxyConfig = fs.readFileSync(
    path.join(deployDir, 'apache-messages-proxy.conf'),
    'utf8'
  );

  assert.ok(proxyConfig.includes(
    'ProxyPassMatch "^/api/messages(?:/.*)?$" "http://127.0.0.1:3001"'
  ));
  assert.match(
    proxyConfig,
    /ProxyPassReverse "\/api\/messages" "http:\/\/127\.0\.0\.1:3001\/api\/messages"/
  );
  assert.doesNotMatch(proxyConfig, /ProxyPass "\/api\/messages"/);
});
