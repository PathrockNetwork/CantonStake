# MainNet node prompt based on the verified TestNet DAR upload

Copy this prompt to the agent on the **existing MainNet validator server**.
It follows the approved operator-host-only model. The operator now reports that
the runbook corrections are applied in rev 3; that remote file was not changed here.
It does **not** authorize an upload, vetting or activation. The earlier proposal
to deliver an uploader token to the app server is superseded; reconsidering that
model requires new explicit authorization. Copy the fenced prompt below; the
preceding evidence notes explain its basis.

## What the TestNet records actually establish

Checked on the app server, without making any new Ledger API requests:

- Build receipt: `.deploy-backups/canton-dar/1791061931705-build-30abdac5-c837-43d2-99b4-daefac3cb5fd.json`.
  Built `cantonstake` 0.0.2 at **2026-10-03 21:12:11 UTC**. The build did not
  request lifecycle tests; do not confuse SDK validation with wallet testing.
- Upload receipt: `.deploy-backups/canton-dar/1791062272252-testnet-85be2bd6-973c-4842-869e-ecddf5babc0c.json`.
  **2026-10-03 21:17:52–21:17:55 UTC**, `action=upload`, Canton **3.5.18**,
  server validation passed, upload accepted, all **33** bundled packages visible,
  zero missing packages. The main package was absent before upload.
- Separate vetting receipt: same basename with `.vetting.json`.
  **2026-10-03 21:25:24 UTC**, read-only `POST /v2/package-vetting/list`,
  **33/33** bundled packages vetted for the recorded participant/synchronizer,
  zero missing packages, topology serial **27**.
- TestNet DAR SHA-256, rechecked against the retained binary:
  `7e7f28a4fad6b739cf38017a44932109820a00881d6ce1b6b153cc76d5b1df81`.
  Main package ID: `23f7aa9deb68fc275ba97db0c173c9232b4b21315e1dbb8ee82a1a63428faf1e`.

The shared helper source establishes the request sequence: local SDK inspection,
metadata reads, raw DAR validation POST, raw DAR upload POST with
`vetAllPackages=true` and the full `synchronizerId`, followed by package inventory.
The upload receipt intentionally did **not** claim independently verified vetting;
the separate topology receipt supplied that evidence. Historical receipts are
not a fresh live-node health check or Five North approval.

The receipts do not preserve the literal shell invocation or authentication
headers. The TestNet handoff described tokenless Ledger API access, subsequently
IP-restricted; do not infer the upload-time protection state from these receipts
or copy tokenless access to MainNet. These private receipts remain outside Git;
only this non-secret summary belongs in the handoff.

## Copyable MainNet node prompt

```text
You are on our existing Canton MainNet validator server. Check readiness for a
later operator-host CantonStake DAR upload, using the successful TestNet sequence
below. Stop after preparation: do not upload or vet packages, provision app
identities or activate any application flow. Writing this prompt does not grant
transfer, SDK installation, token issuance or upload authorization.

TESTNET PRECEDENT — REUSE THE SEQUENCE, NOT ITS AUTHORIZATION
On 2026-10-03, the app-side TestNet workflow locally built/inspected the existing
0.0.2 DAR, validated it against Canton 3.5.18, uploaded its raw bytes over JSON
API v2 with vetAllPackages=true and the full TestNet synchronizer, then checked
GET /v2/packages. A separate read-only vetting query confirmed all 33 packages
and topology serial 27. No participant reinstall, public gRPC, application
deployment restart or ledger transaction was needed to upload the package.
This establishes package deployment, not a funded Loop staking/CC lifecycle.

For MainNet, preserve that checksum/validation/upload/inventory/topology flow,
but run on THIS OPERATOR HOST with authenticated operator-only authority.
Do not infer compatibility with Canton 3.5.17 / Splice 0.8.1 from the TestNet
result or substitute TestNet identities/credentials. The fresh MainNet candidate
has the same main package ID but DIFFERENT archive bytes/checksum. Use the exact
MainNet candidate below, not the old TestNet DAR or its confirmation string.

APPROVED EXECUTION AND CREDENTIAL BOUNDARY
- Upload execution belongs on this operator host, NOT the app server.
- ParticipantAdmin credentials must never transit to or live on the app server,
  its containers, configuration, repository, artifacts or reports.
- Keep the existing authenticated gateway. Do not create a new Auth0 M2M client
  or uploader user, grant rights, change proxy/firewall/CORS/auth configuration
  or restart services without separate approval for the exact change.
- Operator reference: /opt/canton/cantonstake-prep/DAR-RUNBOOK.md (rev 3, reported).
  Preparation report: /tmp/cantonstake-mainnet-upload-preparation.md.
  Check these locally; the app team has only the summarized handoff.
- Future short-lived token location is /root/.cantonstake/mainnet-upload.token
  (private parent 0700, file 0600). Mint only under the operator's approved
  procedure, retain actual expiry/revocation information, and clean up afterward.
  Do not print bearer tokens, client secrets, private keys, raw .env files or
  unredacted Docker environment/configuration. No secrets in argv, chat or Git.
  A raw-curl fallback must use a private header file via curl -H @file, never an
  expanded Authorization header containing the bearer in command arguments.
  Do not use process substitution with printf and an expanded bearer: that still
  puts the secret in a shell-command argument. If a header file is needed, build
  it with file I/O under the approved operator procedure (0600, private parent),
  and delete it alongside the token afterward. The Node helper reads the token
  file directly and does not need a separate header file.
- Token deletion/shredding is cleanup, not a guaranteed erasure of copies from
  snapshots, backups or copy-on-write storage; follow operator secret policy.

EXACT TARGET AND ARTIFACT
MainNet app: https://cantonstake.pathrocknetwork.org
JSON API: https://api.canton.mainnet.pathrocknetwork.org/api/json-api
Synchronizer:
global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc
Participant ID (operator verified from validator DB; recheck against local node):
PAR::pathrocknetwork-validator-1::1220ad5a9f9a041de61967ab54f611bdf1fe53f27d44bb9ad7efbf418aefa7277e48
Reported versions: Canton 3.5.17 / Splice 0.8.1; verify locally.

Candidate currently reported only on the app server:
/root/CantonStake/daml/CantonStake/.daml/dist/cantonstake-0.0.2-mainnet-candidate.dar
Manifest: same directory, cantonstake-0.0.2-mainnet-candidate.manifest.json
Package: cantonstake 0.0.2, Daml SDK 3.4.11, 33 bundled packages
Main package ID:
23f7aa9deb68fc275ba97db0c173c9232b4b21315e1dbb8ee82a1a63428faf1e
SHA-256:
0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51
Daml source commit: 1bbc722045028b8ad76195555fc40714835acc2a

Do not assume the app-server path exists here. Arrange the approved secure
artifact/helper transfer separately; never transfer node credentials back to the
app. Do not rebuild or substitute a different DAR. Verify the transferred DAR's
SHA-256 before any compatibility validation or later upload; mismatch means STOP.

HELPER READINESS
- Node v22.23.2 and Daml SDK 3.4.11 are now reported installed under approved
  preparation. Check existing tooling before considering any installer or SDK
  download; any additional host change needs separate approval. The required
  project SDK is 3.4.11, not the participant core version 3.5.17. Installing the
  CLI SDK does not upgrade the running participant. No application rebuild or
  container restart is required for an artifact inspection/upload operation.
- Use scripts/validate-canton-dar.sh and scripts/upload-canton-dar.sh with their
  shared scripts/canton-dar.mjs, target JSON, project metadata/dependencies and
  the required Node 18+ / Daml SDK. Wrappers alone are insufficient.
- The updated shared helper gives POST /v2/dars 280 seconds; metadata and
  POST /v2/dars/validate retain 60 seconds. The reported proxy limit is 300 seconds.
  Inspect the transferred helper to confirm the update; an old 60-second upload
  helper remains a blocker. --help describes the deadlines; no timeout flag exists.
  Expected SHA-256 of the current updated scripts/canton-dar.mjs:
  ef5e1c74effdcf260c03fb1f2df7c6c269f702c64b7bb52d08ba0a43fc7a8862
  This fix is currently in the app working tree: checking out the earlier source
  commit alone does NOT deliver the updated timeout helper.
- Set both dedicated CANTON_DAR_MAINNET_JSON_API_URL and
  CANTON_DAR_MAINNET_SYNCHRONIZER_ID to the full values above. Do not edit the
  running app's environment or inherit TestNet/LocalNet targets.
- Use --dar for the transferred candidate, --expected-sha256 for the exact hash,
  --token-file for the operator-local private file, and a new --receipt path.
  Upload additionally requires the exact binding below, ONLY after separate
  explicit upload authorization:
  --confirm mainnet:0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51
- Standalone compatibility validation is optional and requires the authorized
  exact artifact and operator access. The upload helper always prevalidates.
  No redirects or automatic retries are permitted. A timeout/interruption may
  leave upload state unknown: inspect the participant before deciding on retry.

PREPARE THE SAME TWO STAGES — DO NOT EXECUTE THE UPLOAD TEMPLATE
The operator reports that receiving files is authorized and the receive directory
/opt/canton/cantonstake-prep/incoming is staged (ubuntu:ubuntu 0750). Use the approved
secure transport; no SSH account, host-key fingerprint or channel has been supplied
to this app-side agent. Do not improvise credentials or weaken host-key verification.

After file delivery, verification and separately authorized operator-local token issuance,
prepare these commands for review. The example assumes a reviewed helper/project
layout under /opt/canton/cantonstake-prep/workflow; this is a PROPOSED destination,
not proof it exists. Replace it with the verified transferred layout if different.
Never install/rebuild packages merely to make that path exist.

cd /opt/canton/cantonstake-prep/workflow
export CANTON_DAR_MAINNET_JSON_API_URL='https://api.canton.mainnet.pathrocknetwork.org/api/json-api'
export CANTON_DAR_MAINNET_SYNCHRONIZER_ID='global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc'

# Optional standalone compatibility validation, not an upload.
# Execute only when the preceding preparation actions are authorized/completed.
bash scripts/validate-canton-dar.sh --network mainnet \
  --dar daml/CantonStake/.daml/dist/cantonstake-0.0.2-mainnet-candidate.dar \
  --expected-sha256 0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51 \
  --token-file /root/.cantonstake/mainnet-upload.token \
  --receipt evidence/mainnet-candidate-validation.json

# FUTURE REFERENCE ONLY — NO UPLOAD AUTHORIZATION HAS BEEN GRANTED.
# Do NOT run during this task. It always validates again before the upload.
bash scripts/upload-canton-dar.sh --network mainnet \
  --dar daml/CantonStake/.daml/dist/cantonstake-0.0.2-mainnet-candidate.dar \
  --expected-sha256 0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51 \
  --confirm mainnet:0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51 \
  --token-file /root/.cantonstake/mainnet-upload.token \
  --receipt evidence/mainnet-candidate-upload.json

Receipt paths must be new: the helper refuses to overwrite them. Record previous
attempts and reconcile unknown state before considering another attempt. The
candidate already bundles 33 packages: inspect/upload it, do not run build or
install a new validator stack. Daml SDK is required by our LOCAL helper inspection;
it is not an extra on-node Ledger API protocol requirement for uploading a DAR.

VERIFY PREPARATION WITHOUT UPLOADING
1. Independently confirm MainNet topology, API/core versions and observation time.
2. Inspect installed schema/proxy routing for GET /v2/version, GET /v2/packages,
   POST /v2/dars/validate and POST /v2/dars. Inspect the upload route only: do NOT
   invoke it. Verify raw application/octet-stream body, query parameters
   vetAllPackages and the full namespaced synchronizerId, timeout/body-size limits
   and ParticipantAdmin authorization requirements against the installed build.
3. Use existing authorized operator credentials for read-only metadata checks.
   Report node-local checks separately from app-server reachability; this model
   does not need app-server upload authority or browser Ledger API CORS access.
4. If the exact artifact is present via authorized transfer, compatibility
   validation may be performed under the established preparation scope. Record
   its result accurately. Otherwise mark it NOT PERFORMED; no substitute package.
5. Verify the separate read-only POST /v2/package-vetting/list schema and pagination
   from the installed OpenAPI. Operator-reported facts: {} is valid; filters are
   participantIds, synchronizerIds, packageIds and packageNamePrefixes; result
   items contain packages[].packageId and topologySerial; pagination returns
   nextPageToken (empty means end). Use the operator's extracted schema and
   prepared commands for the request token field and response envelope; do not
   guess unreported fields. Consume all pages, not just the first.
   Rev 2's .packageIds selector is wrong for this response: use the installed
   packages[].packageId shape instead. GET /v2/packages is a DIFFERENT response,
   where the existing helper's packageIds inventory handling remains valid.
   The TestNet checker used this request structure; treat it as a reference and
   confirm it against MainNet's extracted OpenAPI before using it:
   {
     "packageMetadataFilter": {"packageIds": ["<all 33 inspected package IDs>"]},
     "topologyStateFilter": {
       "participantIds": ["PAR::pathrocknetwork-validator-1::1220ad5a9f9a041de61967ab54f611bdf1fe53f27d44bb9ad7efbf418aefa7277e48"],
       "synchronizerIds": ["global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc"]
     },
     "pageSize": 100
   }
   Expand the package-ID placeholder into the actual receipt/SDK-inspected list;
   never send it literally. TestNet returned vettedPackages[].packages[].packageId
   and accepted pageToken for subsequent pages. Confirm that envelope/token field
   on MainNet, then consume pages until nextPageToken is empty. Abort if a token
   repeats, the response is malformed or traversal is incomplete; do not mark
   partial inventory verified. Check current validFromInclusive/validUntilExclusive
   where present and locally recheck participant/synchronizer IDs after filtering.
6. Prepare, but do not claim completed, the post-upload verification: package
   inventory must contain the main ID and intended bundled packages; vetting
   topology must match the FULL participant and synchronizer IDs and contain the
   main ID among vetted package IDs. Check intended bundled-package vetting too.
   HTTP 200 from upload or package inventory alone is not topology proof.
7. Keep upload/vetting evidence separate from Five North exact-DAR approval.
   No approval can be inferred from local build, node validation or node upload.

Do not allocate provider/treasury/delegator parties, onboard wallets, create
beneficiary splits, prepare/submit ledger transactions, claim rewards or transfer
funds. Do not expose gRPC, disable TLS verification, weaken authentication,
change unrelated metrics/database/DCPM settings or restart app deployments.
Report unrelated risks separately. Existing app deployments remain on LocalNet.

OUTPUT AND STOP
Amend /tmp/cantonstake-mainnet-upload-preparation.md with verified facts, exact
helper readiness/transfer status, approved/applied changes versus proposals,
redacted metadata/validation evidence, real credential expiry/revocation plan
and missing items. Preserve the operator-reported rev 3 runbook and record any discrepancy
for operator review instead of silently changing the approved procedure.

Include this NON-SECRET block, with full verified values or explicit UNKNOWN:
CANTON_DAR_MAINNET_JSON_API_URL=https://api.canton.mainnet.pathrocknetwork.org/api/json-api
CANTON_DAR_MAINNET_SYNCHRONIZER_ID=global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc
UPLOAD_PARTICIPANT_ID=PAR::pathrocknetwork-validator-1::1220ad5a9f9a041de61967ab54f611bdf1fe53f27d44bb9ad7efbf418aefa7277e48
UPLOAD_RUN_LOCATION=operator-host
UPLOAD_CREDENTIALS_DELIVERED_TO_APP_SERVER=false
UPLOAD_TOKEN_FILE=/root/.cantonstake/mainnet-upload.token
UPLOAD_TOKEN_EXPIRES_AT_UTC=<actual expiry, or not issued>
UPLOAD_RIGHTS=<verified operator authority>
UPLOAD_HTTP_TIMEOUT_SECONDS=<verified helper value, expected 280>
METADATA_VALIDATION_HTTP_TIMEOUT_SECONDS=<verified helper value, expected 60>
PROXY_UPLOAD_TIMEOUT_SECONDS=<verified value, reported 300>
DAR_PRESENT_ON_OPERATOR_HOST=<verified true / false>
DAML_SDK_3_4_11_INSTALLED=<verified true / false>
DAR_VALIDATION_RESULT=<passed / not performed / failed>
DAR_SHA256=0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51
DAR_MAIN_PACKAGE_ID=23f7aa9deb68fc275ba97db0c173c9232b4b21315e1dbb8ee82a1a63428faf1e
UPLOAD_AUTHORIZATION=pending
UPLOAD_PERFORMED=false
VETTING_PERFORMED=false
FIVE_NORTH_EXACT_DAR_APPROVAL=pending external confirmation
LOOP_STAKING_ENABLED=false
LOOP_REVIEWED_PACKAGE_ID=<unset>

Return the report path and concise blockers, then stop. No upload, vetting,
application repointing or MainNet activation is authorized by this prompt.
```
