# CantonStake MainNet DAR review candidate

Prepared 2026-10-05 (Europe/Berlin); built at 2026-10-04T23:37:00.239Z.

Status: locally built, validated and reproduced. **Not uploaded, vetted or
compatibility-validated on MainNet. Not approved by Five North.** No production
configuration, party, position, reward or signing gate was changed.

## Artifact identity

| Field | Value |
| --- | --- |
| DAR | `daml/CantonStake/.daml/dist/cantonstake-0.0.2-mainnet-candidate.dar` |
| Manifest | `daml/CantonStake/.daml/dist/cantonstake-0.0.2-mainnet-candidate.manifest.json` |
| Package name/version | `cantonstake` / `0.0.2` |
| SDK | `3.4.11` |
| Source commit | `1bbc722045028b8ad76195555fc40714835acc2a` |
| Daml source tree | `fb42795874e8c24ea37a9c55db8ff4a99eb4269c` |
| Main package ID | `23f7aa9deb68fc275ba97db0c173c9232b4b21315e1dbb8ee82a1a63428faf1e` |
| DAR SHA-256 | `0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51` |
| Bundled packages | 33 |
| Dependency input | `.daml/dars/splice-api-featured-app-v1.dar` |
| Dependency input SHA-256 | `01df2e1b86e3a1b9ab55e97e42f280563c9d1fbe909963c74bef62dd642aa3ee` |

The Daml source/build definition matches the pinned commit. The working tree
also contains documentation/upload-helper changes, which are not compiler inputs. The second
fresh `--no-cache` build produced identical DAR bytes and the same 33 package
IDs. Both artifacts passed SDK `validate-dar` and metadata inspection.

The five existing lifecycle unit scripts passed on 2026-10-04 against this same
main package ID. They were not rerun during this artifact-only task and are not
proof of a genuine Loop wallet lifecycle or MainNet compatibility.

## Why there is no separate MainNet contract version

Inspection found no hardcoded network endpoints, synchronizer identifiers or
concrete party identities in the contract logic. Parties are supplied when
creating contracts; synchronizer routing belongs to the submission/deployment.
The `mainnet-candidate` filename identifies this handoff, not a different package.
The package name/version and main package ID remain the existing v0.0.2 values.

The old TestNet review DAR has SHA-256
`7e7f28a4fad6b739cf38017a44932109820a00881d6ce1b6b153cc76d5b1df81`.
That archive is not byte-identical to this fresh source build, even though its
main package ID is the same. Send the new artifact and checksum together;
do not reuse artifact-specific approval or checksum evidence for the old file.

This package does not implement CC coupon collection/transfers or eliminate the
need for MainNet application work. FeaturedAppRight is optional on the existing
staking choices; app reward eligibility remains a separate integration concern.

## Handoff to the MainNet operator

Use the [upload-preparation server prompt](CANTON_MAINNET_DAR_UPLOAD_PREPARATION_PROMPT.md)
for the approved **operator-host-only** procedure, based on the saved TestNet
upload and separate 33/33 vetting receipts. The operator reports that the runbook
at `/opt/canton/cantonstake-prep/DAR-RUNBOOK.md` has now been corrected to rev 3.
Preparation does not authorize uploading the DAR or enabling the application.
ParticipantAdmin credentials must never transit to or live on the app server.

Transfer only the DAR, its manifest and this guide through the agreed secure
channel. Do not transfer runtime `.env` files, wallet keys or the whole private
backup directory. Generated DARs/manifests remain excluded from Git.
The operator also needs the updated repository helpers, their target JSON and
Daml project metadata/dependencies, Node 18+ and the project's Daml SDK. Copying
only the shell wrappers is insufficient: they invoke `scripts/canton-dar.mjs`,
which inspects the DAR through the SDK before making requests.

Latest operator handoff: Node v22.23.2 and **Daml SDK 3.4.11** are installed,
rev 3 runbook corrections are applied, and receipt of the files is authorized at
`/opt/canton/cantonstake-prep/incoming` (ubuntu:ubuntu, 0750). This is operator-reported
state, not a check performed here. Delivery and on-arrival verification remain
pending; token issuance and upload are not authorized. No validator SDK upgrade
or application/container restart is needed for this CLI workflow.

The inspected shared helper's SHA-256 is
`ef5e1c74effdcf260c03fb1f2df7c6c269f702c64b7bb52d08ba0a43fc7a8862`.
Verify this transferred file as well as the DAR, and inspect `--help` for the
280/60-second split. This helper hash pins the current uncommitted timeout fix,
not the earlier Daml source commit; transfer the actual updated helper, not just
the old committed version.

Verify the transferred binary:

```bash
sha256sum cantonstake-0.0.2-mainnet-candidate.dar
# Expected: 0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51
```

Then, under separately authorized server preparation:

1. Confirm the authenticated MainNet JSON API route/schema supports DAR
   compatibility validation on its Canton 3.5.17 participant. This version is
   from the operator handoff, not a compatibility guarantee from the local build.
2. Use the full verified MainNet synchronizer ID and operator-local
   ParticipantAdmin authorization. Keep the short-lived token in
   `/root/.cantonstake/mainnet-upload.token` (parent 0700, file 0600), never in
   command arguments, chat, app configuration or transfer bundles. Follow the
   operator's expiry/revocation and cleanup procedure after the operation.
3. Optionally run standalone validation and retain its receipt; the upload helper
   always validates again before upload. A validation pass does not upload,
   vet, approve external signing, confer reward eligibility or prove payment.
4. Only after explicit upload authorization, upload/vet these exact bytes and
   independently verify package inventory and synchronizer vetting. Provide this
   exact candidate separately for Five North's MainNet review/hosting approval.

On the **operator host**, configure both dedicated target overrides. MainNet
remains unconfigured by default in `scripts/canton-dar.targets.json`; these full
values were supplied in the operator handoff and do not repoint the running app.

```bash
export CANTON_DAR_MAINNET_JSON_API_URL='https://api.canton.mainnet.pathrocknetwork.org/api/json-api'
export CANTON_DAR_MAINNET_SYNCHRONIZER_ID='global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc'
# Use an existing private token file; never paste bearer tokens in chat or CLI arguments.

bash scripts/validate-canton-dar.sh --network mainnet \
  --dar daml/CantonStake/.daml/dist/cantonstake-0.0.2-mainnet-candidate.dar \
  --expected-sha256 0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51 \
  --token-file /root/.cantonstake/mainnet-upload.token
```

Missing target values fail closed before remote calls. Do not run upload as part
of this handoff. Its separately authorized invocation must bind these exact bytes
with `--confirm mainnet:0db5d91ed8f2c6208cb2bb2ddac3f16f04fd346381fa57ca05bfa099a854be51`.

The shared helper now gives only `POST /v2/dars` a **280-second** HTTP deadline,
below the operator-reported 300-second proxy limit. Validation and metadata reads
remain at 60 seconds. Redirects and automatic retries remain disabled. After an
upload timeout/interruption, check node state before deciding whether to retry.

Package inventory is not vetting proof. The operator must separately query
`POST /v2/package-vetting/list` (`{}` is valid on the installed schema), follow
its pagination, and match the full participant ID from local topology and the
full synchronizer above. The operator has now verified the full participant ID:
`PAR::pathrocknetwork-validator-1::1220ad5a9f9a041de61967ab54f611bdf1fe53f27d44bb9ad7efbf418aefa7277e48`.
Confirm the main package ID in the vetted package IDs and check the intended
bundled-package vetting. Do not infer topology propagation from upload HTTP 200.
Keep this evidence separate from Five North approval.

The installed vetting schema, as reported by the operator, uses camelCase filters
`participantIds`, `synchronizerIds`, `packageIds`, `packageNamePrefixes`, items
containing `packages[].packageId` and `topologySerial`, and `nextPageToken` (empty
means end). Use the exact response envelope/request pagination field in the
operator's extracted schema and prepared commands. Rev 2's `.packageIds` jq
selector is incorrect for the vetting response, but the helper's `packageIds`
handling for **GET /v2/packages** is a separate, valid inventory schema.

The operator reports both rev 3 corrections have now been applied:
the vetting selector and the raw-curl header handling. `-H @<(printf ...TOKEN...)`
still expands a bearer into a shell-command argument. Use the Node helper's
direct private-file read, or construct a 0600 header file via file I/O and pass
`curl -H @file`. No remote runbook was edited here.

## Gates that remain closed

Keep `LOOP_STAKING_ENABLED=false`, leave `LOOP_REVIEWED_PACKAGE_ID` unset and do
not repoint the app's current Canton connection. Upload on our own node is not
Five North deployment on the participant hosting real Loop users. Provider and
treasury provisioning, dedicated service access, MainNet ownership/receipt
verification, token renewal, preservation of old LocalNet position exits and
genuine funded lifecycle verification remain separate work. Actual CC
collection/payment is another independently verified milestone.

See [the MainNet read-only node prompt](CANTON_MAINNET_NODE_PROMPT.md),
[Loop release gates](loop-testnet-integration.md) and
[the production rollout record](production-rollout-2026-10-04.md).
