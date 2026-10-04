#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetFile = resolve(repoDir, 'scripts/canton-dar.targets.json');
const defaultProject = resolve(repoDir, 'daml/CantonStake');
const networks = ['testnet', 'devnet', 'mainnet'];
const actions = ['build', 'validate', 'upload'];

export const help = `CantonStake DAR workflows (Node 18+ and the project's Daml SDK required)

  node scripts/canton-dar.mjs build [--project PATH] [--dar PATH] [--run-tests]
  node scripts/canton-dar.mjs validate --network testnet|devnet|mainnet [options]
  node scripts/canton-dar.mjs upload --network testnet|devnet|mainnet \\
    --confirm NETWORK:SHA256 [options]

Options:
  --project PATH          Daml project (default: daml/CantonStake)
  --dar PATH              Artifact (default: project's name/version in .daml/dist)
  --config PATH           Target JSON (default: scripts/canton-dar.targets.json)
  --expected-sha256 HASH   Refuse a different artifact
  --token-file PATH       Read a bearer token from a private file, never CLI text
  --receipt PATH          New audit JSON file; existing files are never overwritten
  --run-tests             Run daml test before build (requires Java and actual tests)
  --confirm NETWORK:HASH  Required for upload, bound to network and exact DAR bytes

Target overrides (both must be supplied together):
  CANTON_DAR_<NETWORK>_JSON_API_URL
  CANTON_DAR_<NETWORK>_SYNCHRONIZER_ID
Optional secret: CANTON_DAR_<NETWORK>_AUTH_TOKEN

validate changes no remote state. upload always validates first, then uploads
with vetAllPackages=true on the explicit synchronizer. No automatic retries,
redirects, package deletion, app restart, or production .env loading.
Compatibility validation does NOT establish business correctness or CC eligibility.
`;

export function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [action, ...args] = argv;
  if (!actions.includes(action)) throw new Error('Choose build, validate, or upload; use --help.');
  const options = { action };
  const names = {
    '--network': 'network', '--project': 'project', '--dar': 'dar',
    '--config': 'config', '--expected-sha256': 'expectedSha256',
    '--token-file': 'tokenFile', '--receipt': 'receipt', '--confirm': 'confirm',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-tests') {
      if (options.runTests) throw new Error('Duplicate --run-tests.');
      options.runTests = true;
      continue;
    }
    const name = names[args[i]];
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Unknown option or missing value; use --help.');
    }
    if (options[name] !== undefined) throw new Error(`Duplicate option: ${args[i]}`);
    options[name] = args[++i];
  }
  if (action !== 'build' && !networks.includes(options.network)) {
    throw new Error('An explicit --network testnet, devnet, or mainnet is required.');
  }
  if (action !== 'build' && options.runTests) throw new Error('--run-tests is only valid for build.');
  if (action === 'build' && ['network', 'confirm', 'tokenFile', 'config', 'expectedSha256'].some(k => options[k])) {
    throw new Error('build is local only; remote target/auth/confirmation options do not apply.');
  }
  if (action === 'validate' && options.confirm) throw new Error('--confirm is only valid for upload.');
  return options;
}

export function resolveTarget(network, config, env = process.env) {
  if (!networks.includes(network)) throw new Error('Invalid network.');
  const prefix = `CANTON_DAR_${network.toUpperCase()}_`;
  const overrideUrl = env[`${prefix}JSON_API_URL`];
  const overrideId = env[`${prefix}SYNCHRONIZER_ID`];
  if (Boolean(overrideUrl) !== Boolean(overrideId)) {
    throw new Error(`Set both ${prefix}JSON_API_URL and ${prefix}SYNCHRONIZER_ID together.`);
  }
  const target = overrideUrl ? { jsonApiUrl: overrideUrl, synchronizerId: overrideId } : config[network];
  if (!target?.jsonApiUrl || !target?.synchronizerId) {
    throw new Error(`No verified ${network} target configured. Set its dedicated endpoint and synchronizer ID.`);
  }
  let url;
  try { url = new URL(target.jsonApiUrl); } catch { throw new Error('Invalid JSON API URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('JSON API URL must be HTTPS with no credentials, query, or fragment.');
  }
  if (!/^[^\s:]+::1220[0-9a-f]{64}$/.test(target.synchronizerId)) {
    throw new Error('Synchronizer ID must be complete, not abbreviated.');
  }
  const knownTestnet = JSON.parse(readFileSync(targetFile, 'utf8')).testnet;
  if (network !== 'testnet' && (url.hostname === new URL(knownTestnet.jsonApiUrl).hostname ||
      target.synchronizerId === knownTestnet.synchronizerId)) {
    throw new Error(`Refusing to use the known TestNet target as ${network}.`);
  }
  return { network, jsonApiUrl: url.toString().replace(/\/$/, ''), synchronizerId: target.synchronizerId };
}

function daml(args, project, capture = false) {
  try {
    return execFileSync('daml', args, {
      cwd: project, encoding: 'utf8', timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
  } catch {
    throw new Error(`Daml ${args[0]} failed. Check the installed SDK, project dependencies, and Java for tests.`);
  }
}

function projectArtifact(project) {
  const yaml = readFileSync(resolve(project, 'daml.yaml'), 'utf8');
  const field = name => yaml.match(new RegExp(`^${name}:\\s*["']?([a-zA-Z0-9_.-]+)["']?\\s*$`, 'm'))?.[1];
  const name = field('name');
  const version = field('version');
  if (!name || !version) throw new Error('Cannot determine project name/version; supply --dar explicitly.');
  return resolve(project, '.daml/dist', `${name}-${version}.dar`);
}

export function inspectArtifact(darPath, project, expectedSha256, runDaml = daml) {
  const bytes = readFileSync(darPath);
  if (!bytes.length) throw new Error('DAR is empty.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 && (!/^[0-9a-f]{64}$/.test(expectedSha256) || expectedSha256 !== sha256)) {
    throw new Error('DAR checksum does not match --expected-sha256.');
  }
  runDaml(['damlc', 'validate-dar', darPath], project, true);
  const info = JSON.parse(runDaml(['damlc', 'inspect-dar', darPath, '--json'], project, true));
  const packageId = info.main_package_id;
  const packageIds = Object.keys(info.packages ?? {});
  if (!/^[0-9a-f]{64}$/.test(packageId) || !packageIds.includes(packageId) ||
      packageIds.some(id => !/^[0-9a-f]{64}$/.test(id))) throw new Error('Invalid package metadata from Daml.');
  if (createHash('sha256').update(readFileSync(darPath)).digest('hex') !== sha256) {
    throw new Error('DAR changed during inspection; refusing to continue.');
  }
  const main = info.packages[packageId];
  return {
    bytes,
    metadata: { darPath, sha256, packageId, packageName: main.name, packageVersion: main.version, packageIds },
  };
}

export function requireConfirmation(action, target, metadata, confirmation) {
  if (action === 'upload' && confirmation !== `${target.network}:${metadata.sha256}`) {
    throw new Error(`Upload requires --confirm ${target.network}:${metadata.sha256}`);
  }
}

function readToken(options, network) {
  const token = (options.tokenFile ? readFileSync(resolve(options.tokenFile), 'utf8') :
    process.env[`CANTON_DAR_${network.toUpperCase()}_AUTH_TOKEN`] ?? '').trim();
  if (options.tokenFile && !token) throw new Error('Token file is empty.');
  if (/\s/.test(token) || token.length > 65536) throw new Error('Invalid bearer token format.');
  return token;
}

export function createRequest(target, token, fetchImpl = fetch) {
  return async (path, { method = 'GET', bytes } = {}) => {
    const url = new URL(`${target.jsonApiUrl}${path}`);
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (bytes) headers['Content-Type'] = 'application/octet-stream';
    let response;
    try {
      response = await fetchImpl(url, {
        method, headers, body: bytes, redirect: 'manual', signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new Error(`${method} ${url.pathname}: network error or timeout. No retry was attempted; check node state before retrying an upload.`);
    }
    if (response.status !== 200) {
      // Do not echo server bodies: auth proxies may reflect tokens or credentials.
      throw new Error(`${method} ${url.pathname}: HTTP ${response.status}. No redirect/retry was attempted.`);
    }
    let body;
    try { body = await response.text(); } catch {
      throw new Error(`${method} ${url.pathname}: response interrupted. Check node state before retrying an upload.`);
    }
    if (!body.trim()) return undefined;
    try { return JSON.parse(body); } catch { throw new Error(`${method} ${url.pathname}: invalid JSON response.`); }
  };
}

function packageList(response) {
  if (!Array.isArray(response?.packageIds) || response.packageIds.some(id => typeof id !== 'string')) {
    throw new Error('Invalid package list response.');
  }
  return response.packageIds;
}

// Kept separate from CLI/file I/O so every remote mutation path can be tested with a fake transport.
export async function executeRemote({ action, target, artifact, confirm }, { request, saveReceipt, log = console.log }) {
  if (!['validate', 'upload'].includes(action)) throw new Error('Invalid remote action.');
  requireConfirmation(action, target, artifact.metadata, confirm);
  const receipt = {
    startedAt: new Date().toISOString(), action, target, artifact: artifact.metadata,
    validation: 'not_attempted', upload: 'not_attempted', packageVerification: 'not_attempted',
    vetting: 'not_attempted',
  };
  const persist = () => saveReceipt({ ...receipt, updatedAt: new Date().toISOString() });
  try {
    persist();
    const version = await request('/v2/version');
    if (!version?.version) throw new Error('Node did not return a Ledger API version.');
    receipt.cantonVersion = version.version;
    const before = packageList(await request('/v2/packages'));
    receipt.packagePresentBefore = before.includes(artifact.metadata.packageId);
    const query = new URLSearchParams({ synchronizerId: target.synchronizerId });
    receipt.validation = 'in_flight';
    persist();
    await request(`/v2/dars/validate?${query}`, { method: 'POST', bytes: artifact.bytes });
    receipt.validation = 'passed';
    persist();
    log('Server compatibility validation passed (HTTP 200).');
    if (action === 'validate') {
      log(`No upload/vetting performed. Upload confirmation: ${target.network}:${artifact.metadata.sha256}`);
      return receipt;
    }
    query.set('vetAllPackages', 'true');
    receipt.upload = 'in_flight';
    receipt.vetting = 'requested';
    persist();
    await request(`/v2/dars?${query}`, { method: 'POST', bytes: artifact.bytes });
    receipt.upload = 'accepted';
    // An HTTP acknowledgement is not independently observed topology propagation.
    receipt.vetting = 'request_accepted_not_independently_verified';
    persist();
    const after = new Set(packageList(await request('/v2/packages')));
    receipt.missingPackages = artifact.metadata.packageIds.filter(id => !after.has(id));
    if (receipt.missingPackages.length) {
      receipt.packageVerification = 'failed';
      throw new Error('Upload was accepted, but some bundled packages are not visible. Inspect the receipt and node before retrying.');
    }
    receipt.packageVerification = 'passed';
    log('Upload accepted; all bundled packages are visible. Vetting was requested on the target synchronizer; verify topology propagation on the node.');
    return receipt;
  } catch (error) {
    if (receipt.validation === 'in_flight') receipt.validation = 'failed';
    receipt.error = error.message;
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    persist();
  }
}

function receiptWriter(path) {
  mkdirSync(dirname(path), { recursive: true });
  // Reserve the audit file before any remote operation; never overwrite somebody else's file.
  const fd = openSync(path, 'wx', 0o600);
  return {
    save(receipt) {
      const content = `${JSON.stringify(receipt, null, 2)}\n`;
      ftruncateSync(fd, 0);
      writeSync(fd, content, 0, 'utf8');
    },
    close() { closeSync(fd); },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log(help); return; }
  const project = resolve(options.project ?? defaultProject);
  if (!existsSync(resolve(project, 'daml.yaml'))) throw new Error('Daml project not found.');
  const darPath = options.dar ? resolve(options.dar) : projectArtifact(project);
  let target;
  if (options.action !== 'build') {
    const config = JSON.parse(readFileSync(resolve(options.config ?? targetFile), 'utf8'));
    target = resolveTarget(options.network, config);
  }
  if (options.action === 'build') {
    if (options.runTests) daml(['test'], project);
    daml(['build', '--no-cache', '-o', darPath], project);
  }
  const artifact = inspectArtifact(darPath, project, options.expectedSha256);
  console.log(JSON.stringify({ action: options.action, target, artifact: artifact.metadata }, null, 2));
  requireConfirmation(options.action, target, artifact.metadata, options.confirm);
  const token = target ? readToken(options, target.network) : '';
  const receiptPath = options.receipt ? resolve(options.receipt) : resolve(repoDir, '.deploy-backups/canton-dar',
    `${Date.now()}-${options.network ?? 'build'}-${randomUUID()}.json`);
  const writer = receiptWriter(receiptPath);
  console.log(`Audit receipt: ${receiptPath}`);
  try {
    if (options.action === 'build') {
      writer.save({ action: 'build', builtAt: new Date().toISOString(), artifact: artifact.metadata, testsRequested: !!options.runTests });
      console.log('DAR built and locally validated. No remote action performed.');
    } else {
      await executeRemote({ ...options, target, artifact }, { request: createRequest(target, token), saveReceipt: writer.save });
    }
  } finally { writer.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`DAR workflow failed: ${error.message}`); process.exitCode = 1; });
}
