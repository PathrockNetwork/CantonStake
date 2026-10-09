import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequest, executeRemote, inspectArtifact, parseArgs, requireConfirmation, resolveTarget } from './canton-dar.mjs';

const config = JSON.parse(readFileSync(new URL('./canton-dar.targets.json', import.meta.url), 'utf8'));
const target = resolveTarget('testnet', config, {});
const id = 'a'.repeat(64);
const dep = 'b'.repeat(64);
const sha256 = 'c'.repeat(64);
const artifact = { bytes: Buffer.from('mock DAR'), metadata: { sha256, packageId: id, packageIds: [id, dep] } };
const confirm = `testnet:${sha256}`;

function harness({ failValidation = false, after = [id, dep], failUpload = false } = {}) {
  const calls = [];
  const receipts = [];
  let reads = 0;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === '/v2/version') return { version: '3.5.18' };
    if (path === '/v2/packages') return { packageIds: ++reads === 1 ? [dep] : after };
    if (path.startsWith('/v2/dars/validate?')) {
      if (failValidation) throw new Error('HTTP 400');
      return undefined;
    }
    if (path.startsWith('/v2/dars?')) {
      if (failUpload) throw new Error('upload timeout');
      return {};
    }
    throw new Error('Unexpected request');
  };
  return { calls, receipts, deps: { request, saveReceipt: r => receipts.push(structuredClone(r)), log: () => {} } };
}

test('CLI requires an action and explicit remote network', () => {
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['upload']));
  assert.throws(() => parseArgs(['validate', '--network', 'production']));
  assert.deepEqual(parseArgs(['validate', '--network', 'testnet']), { action: 'validate', network: 'testnet' });
});

test('CLI rejects unknown/duplicate options and remote options on local build', () => {
  assert.throws(() => parseArgs(['validate', '--network', 'testnet', '--yes']));
  assert.throws(() => parseArgs(['validate', '--network', 'testnet', '--network', 'mainnet']));
  assert.throws(() => parseArgs(['build', '--network', 'mainnet']));
  assert.throws(() => parseArgs(['validate', '--network', 'testnet', '--confirm', confirm]));
});

test('DevNet and TestNet have distinct targets; MainNet never inherits either endpoint', () => {
  assert.equal(target.jsonApiUrl, config.testnet.jsonApiUrl);
  assert.throws(() => resolveTarget('mainnet', config, {}), /No verified mainnet/);
  const devnet = resolveTarget('devnet', config, {});
  assert.equal(devnet.jsonApiUrl, config.devnet.jsonApiUrl);
  assert.notEqual(devnet.jsonApiUrl, target.jsonApiUrl);
  assert.notEqual(devnet.synchronizerId, target.synchronizerId);
});

test('network-scoped overrides require both URL and complete synchronizer ID', () => {
  assert.throws(() => resolveTarget('mainnet', config, { CANTON_DAR_MAINNET_JSON_API_URL: 'https://ledger.example/api' }), /both/);
  const env = {
    CANTON_DAR_MAINNET_JSON_API_URL: 'https://ledger.example/api/',
    CANTON_DAR_MAINNET_SYNCHRONIZER_ID: `global-domain::1220${dep}`,
  };
  assert.equal(resolveTarget('mainnet', config, env).jsonApiUrl, 'https://ledger.example/api');
  assert.throws(() => resolveTarget('mainnet', config, { ...env, CANTON_DAR_MAINNET_SYNCHRONIZER_ID: 'global::123...' }), /complete/);
});

test('known TestNet endpoint or synchronizer cannot masquerade as MainNet', () => {
  assert.throws(() => resolveTarget('mainnet', { mainnet: config.testnet }, {}), /Refusing/);
  assert.throws(() => resolveTarget('mainnet', { mainnet: { jsonApiUrl: 'https://ledger.example', synchronizerId: config.testnet.synchronizerId } }, {}), /Refusing/);
});

test('unsafe HTTP, URL credentials, queries, and fragments are rejected', () => {
  for (const jsonApiUrl of ['http://ledger.example', 'https://user:secret@ledger.example', 'https://ledger.example?token=secret', 'https://ledger.example#fragment']) {
    assert.throws(() => resolveTarget('testnet', { testnet: { ...config.testnet, jsonApiUrl } }, {}), /HTTPS/);
  }
});

test('confirmation is bound to exact network and checksum', () => {
  assert.throws(() => requireConfirmation('upload', target, artifact.metadata, undefined), /requires/);
  assert.throws(() => requireConfirmation('upload', target, artifact.metadata, `mainnet:${sha256}`));
  assert.throws(() => requireConfirmation('upload', target, artifact.metadata, `testnet:${id}`));
  requireConfirmation('upload', target, artifact.metadata, confirm);
});

test('no remote calls or receipt writes occur without upload confirmation', async () => {
  const h = harness();
  await assert.rejects(executeRemote({ action: 'upload', target, artifact }, h.deps), /requires/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.receipts.length, 0);
});

test('validation targets the explicit synchronizer and does not upload', async () => {
  const h = harness();
  const receipt = await executeRemote({ action: 'validate', target, artifact }, h.deps);
  const validation = h.calls.find(c => c.path.startsWith('/v2/dars/validate?'));
  assert.equal(new URL(`https://example${validation.path}`).searchParams.get('synchronizerId'), target.synchronizerId);
  assert.equal(validation.method, 'POST');
  assert.strictEqual(validation.bytes, artifact.bytes);
  assert.equal(h.calls.filter(c => c.path.startsWith('/v2/dars?')).length, 0);
  assert.equal(receipt.validation, 'passed');
  assert.equal(receipt.upload, 'not_attempted');
});

test('upload is always preceded by validation and verifies all bundled packages', async () => {
  const h = harness();
  const receipt = await executeRemote({ action: 'upload', target, artifact, confirm }, h.deps);
  assert.equal(h.calls.length, 5);
  assert.match(h.calls[2].path, /^\/v2\/dars\/validate\?/);
  const upload = new URL(`https://example${h.calls[3].path}`);
  assert.equal(upload.pathname, '/v2/dars');
  assert.equal(upload.searchParams.get('vetAllPackages'), 'true');
  assert.equal(upload.searchParams.get('synchronizerId'), target.synchronizerId);
  assert.equal(receipt.upload, 'accepted');
  assert.equal(receipt.packageVerification, 'passed');
  assert.equal(receipt.vetting, 'request_accepted_not_independently_verified');
});

test('validation failure never reaches upload and is recorded', async () => {
  const h = harness({ failValidation: true });
  await assert.rejects(executeRemote({ action: 'upload', target, artifact, confirm }, h.deps), /400/);
  assert.equal(h.calls.filter(c => c.path.startsWith('/v2/dars?')).length, 0);
  assert.equal(h.receipts.at(-1).upload, 'not_attempted');
  assert.match(h.receipts.at(-1).error, /400/);
});

test('ambiguous upload timeout is not retried and remains in flight in receipt', async () => {
  const h = harness({ failUpload: true });
  await assert.rejects(executeRemote({ action: 'upload', target, artifact, confirm }, h.deps), /timeout/);
  assert.equal(h.calls.filter(c => c.path.startsWith('/v2/dars?')).length, 1);
  assert.equal(h.receipts.at(-1).upload, 'in_flight');
});

test('HTTP acceptance does not hide missing packages or imply verified topology', async () => {
  const h = harness({ after: [id] });
  await assert.rejects(executeRemote({ action: 'upload', target, artifact, confirm }, h.deps), /not visible/);
  assert.equal(h.receipts.at(-1).upload, 'accepted');
  assert.equal(h.receipts.at(-1).packageVerification, 'failed');
  assert.deepEqual(h.receipts.at(-1).missingPackages, [dep]);
});

test('transport uses binary content and a bearer header, never retries/follows redirects', async () => {
  let call;
  const request = createRequest(target, 'private-token', async (url, options) => {
    call = { url, options };
    return new Response(null, { status: 200 });
  });
  assert.equal(await request('/v2/dars/validate', { method: 'POST', bytes: artifact.bytes }), undefined);
  assert.equal(call.options.redirect, 'manual');
  assert.equal(call.options.headers.Authorization, 'Bearer private-token');
  assert.equal(call.options.headers['Content-Type'], 'application/octet-stream');
  assert.strictEqual(call.options.body, artifact.bytes);
  let attempts = 0;
  const redirect = createRequest(target, 'private-token', async () => {
    attempts++;
    return new Response('private-token', { status: 307 });
  });
  await assert.rejects(redirect('/v2/dars'), e => e.message.includes('HTTP 307') && !e.message.includes('private-token'));
  assert.equal(attempts, 1);
});

test('only the exact upload POST gets a 280-second deadline', async t => {
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });
  const request = createRequest(target, '', async () => new Response('{}', { status: 200 }));
  const cases = [
    ['/v2/dars', 'POST', 280_000],
    ['/v2/dars?vetAllPackages=true&synchronizerId=global', 'POST', 280_000],
    ['/v2/dars/validate', 'POST', 60_000],
    ['/v2/dars/validate?synchronizerId=global', 'POST', 60_000],
    ['/v2/version', 'GET', 60_000],
    ['/v2/packages', 'GET', 60_000],
    ['/v2/dars', 'GET', 60_000],
    ['/v2/dars/other', 'POST', 60_000],
  ];
  for (const [path, method] of cases) await request(path, { method });
  assert.deepEqual(deadlines, cases.map(([, , milliseconds]) => milliseconds));
});

test('transport errors do not print reflected credentials', async () => {
  const request = createRequest(target, 'private-token', async () => new Response('private-token', { status: 401 }));
  await assert.rejects(request('/v2/dars'), e => e.message.includes('HTTP 401') && !e.message.includes('private-token'));
  const failure = createRequest(target, 'private-token', async () => { throw new Error('private-token'); });
  await assert.rejects(failure('/v2/dars'), e => e.message.includes('network error') && !e.message.includes('private-token'));
});

test('artifact checksum and SDK metadata are checked before a remote workflow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canton-dar-test-'));
  try {
    const path = join(dir, 'fixture.dar');
    writeFileSync(path, artifact.bytes);
    const hash = createHash('sha256').update(artifact.bytes).digest('hex');
    const info = { main_package_id: id, packages: { [id]: { name: 'fixture', version: '0.0.2' }, [dep]: {} } };
    const runDaml = args => args[1] === 'inspect-dar' ? JSON.stringify(info) : 'valid';
    assert.equal(inspectArtifact(path, dir, hash, runDaml).metadata.packageId, id);
    assert.throws(() => inspectArtifact(path, dir, sha256, runDaml), /checksum/);
    assert.throws(() => inspectArtifact(path, dir, hash, () => { throw new Error('invalid DAR'); }), /invalid DAR/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('artifact mutation during SDK inspection is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canton-dar-test-'));
  try {
    const path = join(dir, 'fixture.dar');
    writeFileSync(path, artifact.bytes);
    const runDaml = args => {
      if (args[1] !== 'inspect-dar') return 'valid';
      writeFileSync(path, 'changed');
      return JSON.stringify({ main_package_id: id, packages: { [id]: {} } });
    };
    assert.throws(() => inspectArtifact(path, dir, undefined, runDaml), /changed during inspection/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
