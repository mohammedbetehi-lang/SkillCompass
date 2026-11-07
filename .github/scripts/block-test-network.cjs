'use strict';
// CI test-only guard: mock fetch may replace globalThis.fetch, but actual network
// APIs remain blocked. Never load this guard in the application runtime.
function blocked(api) {
  return function denyNetwork() {
    throw new Error(`Network disabled during tests: ${api}`);
  };
}
globalThis.fetch = blocked('fetch');
for (const name of ['http', 'https']) {
  const module = require(`node:${name}`);
  module.request = blocked(`${name}.request`);
  module.get = blocked(`${name}.get`);
}
require('node:net').Socket.prototype.connect = blocked('net.Socket.connect');
require('node:tls').connect = blocked('tls.connect');
