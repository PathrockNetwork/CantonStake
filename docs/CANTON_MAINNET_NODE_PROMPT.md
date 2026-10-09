# Canton MainNet validator server prompt

Copy the complete prompt below into the agent connected to the existing Canton
MainNet validator server. This gathers a handoff; it does not authorize deployment
or activation. Return the redacted report to the CantonStake application team.

A locally built DAR review candidate and its checksum are documented in
[`CANTON_MAINNET_DAR.md`](CANTON_MAINNET_DAR.md). This inspection prompt does not
authorize uploading or vetting it.

```text
You are connected to our existing Canton MainNet validator server. Gather the
verified technical handoff needed to integrate CantonStake, whose MainNet app is:

https://cantonstake.pathrocknetwork.org

CONTEXT
- The validator already exists. Do not reinstall or reprovision it.
- The app code is deployed, but its Canton ledger connection still uses LocalNet.
- Real external Loop MainNet staking and CC payments are deliberately gated.
- The staged external staking adapter is TestNet-only. A node handoff alone
  cannot enable or certify the missing MainNet application integration.
- Users must sign through genuine Loop wallets. A hosted backend service party
  is not an end-user wallet or a substitute for external signing.

SCOPE AND SAFETY
Inspect existing configuration, local service metadata, bounded/redacted logs,
package/topology records and read-only APIs. The only permitted persistent write
is the requested report:

/tmp/cantonstake-mainnet-node-handoff.md

Do not change configuration, firewall/allowlists, authentication, topology or
user rights. Do not restart containers, install tools, allocate parties/users,
upload/vet DARs, prepare/submit transactions, claim rewards or transfer funds.
Do not try a write to prove that write protection works. If an endpoint or
permission is missing, report it; do not fix it during this inspection.

Keep tokens, private keys, seeds, passwords and client secrets out of the report
and chat. Use existing authorized credentials privately for read-only checks;
never print bearer headers, raw .env files, full Docker environment/config dumps
or credential-bearing URLs. Report secret-manager references or credential file
locations, not their values. Avoid unrelated users' identities and wallet data.

Record the UTC observation time and evidence source for each finding. Use full
non-secret party IDs, package IDs, synchronizer IDs and relevant contract IDs,
not truncated values. Redact secrets in commands and responses. Use bounded
requests; stop retrying an unavailable API and record the failure.

GATHER THE FOLLOWING

1. Network identity and current health
   - Independently establish Canton MainNet from synchronizer/DSO/topology or
     authoritative configured network identifiers, not a container/domain name.
   - Full participant ID, validator/operator party, synchronizer ID and alias,
     DSO party and migration ID, where applicable.
   - Canton, Splice, JSON Ledger API and deployed image versions/digests.
   - Participant synchronization, validator readiness and recent bounded errors.

2. Exact endpoints and routing
   - External JSON Ledger API v2 base URL and any distinct user-party endpoint.
   - gRPC Ledger API, validator/wallet API, Wallet UI and Scan/Scan-proxy URLs.
   - Internal Docker/local endpoints, public TLS ports, proxy prefixes and
     HTTP/2 requirements. Identify broken or unsupported paths explicitly.
   - For safe GET probes, record URL without credentials, status and a redacted
     response shape; distinguish local success from external/app-server access.
   - Verify version/readiness/ledger-end routes where supported. Do not guess
     that port 2975 or any TestNet URL is usable on this MainNet deployment.

3. Access protection and service authorization
   - Relevant proxy locations, firewall rules and existing authenticated gateway
     or IP allowlist. Report whether the ledger/admin and validator APIs are
     public, protected or not established from available evidence.
   - The app server's last reported egress IP is 169.58.171.187. Confirm whether
     it is allowed, but do not modify rules or assume that is still its IP.
   - Identity-provider issuer, token endpoint, JWKS, API audience, supported
     authentication mode, token expiry/renewal and secure credential references.
   - Dedicated CantonStake service user ID, identity-provider scope and relevant
     existing actAs/readAs/admin rights. Report excessive rights if present.
   - Separate IP reachability from authenticated per-user authorization: an
     allowlist alone does not establish an external Loop user's signing rights.
   - Do not claim a browser can call an IP-restricted Ledger API. Identify which
     calls must go through the CantonStake backend and existing CORS restrictions.

4. Existing application identities, packages and contracts
   - Full CantonStake provider and treasury parties, their hosting participant
     and actual service-user/wallet automation setup. Mark missing identities.
   - Any hosted test/service delegator separately; never label it a Loop user.
   - Installed CantonStake package name/version/main package ID, dependency
     package IDs and existing DAR path/checksum, if accessible read-only.
   - Distinguish package upload, vetting, synchronizer applicability and approval
     on the participant hosting Loop users; one does not establish the others.
   - Existing relevant BeneficiarySplit contract IDs, recipient parties and
     weights. State whether a split is shared, per-user or unknown.
   - FeaturedAppRight or other current app eligibility evidence, owner/provider,
     active status and relevant contract ID, or explicitly NOT FOUND/UNKNOWN.
   - Query only the application party's relevant contract inventory. Do not
     enumerate unrelated end-user balances or call any create/exercise route.

5. Genuine Loop MainNet signing and hosting
   - Existing supported wallet providers, verified network identifiers and URLs.
   - Whether any real Loop user party is known to be hosted on this participant,
     another participant, or not established. Do not invent or create a user.
   - Existing public evidence or operator records of Five North's custom-DAR
     review/deployment for the exact MainNet package. If absent, mark UNKNOWN
     or PENDING EXTERNAL CONFIRMATION; do not infer approval from our own upload.
   - Whether provider-observed request creates, cancellation and non-consuming
     unbond choices can be queried across the actual hosting topology. Separate
     API capability from an observed real Loop transaction.
   - Interactive prepare/execute API availability and required signing/topology
     prerequisites from installed schema/docs only. Do not call these endpoints
     or present interactive-submission support as a completed Loop integration.
   - Identify necessary operator/Five North coordination without granting the
     backend blanket actAs rights over external users or importing user keys.

6. Ledger API v2 compatibility, inspected without submitting
   - Installed schema/docs and real read-only response shapes for ledger-end,
     active contracts, package inventory, update lookup and contract history.
   - Required command envelope, userId, actAs/readAs, synchronizer routing,
     package selection, event/filter format, offsets and pruning/retention limits.
   - Whether provider views can expose the exact exercise/controller/update
     evidence needed to distinguish Cancel from Accept and verify RequestUnbond.
   - No command submission, interactive preparation or speculative write probes.
     Read-only POST queries such as ACS are permitted only on known query routes.

7. Real CC rewards, collection and payments
   - Supported reward/activity records and contract/interface/package IDs,
     current rounds, expiry semantics and app eligibility evidence.
   - Actual observation, coupon assignment, claiming/minting, transfer and
     settlement-confirmation mechanisms exposed by the installed services.
   - Supported beneficiary hosting, wallet onboarding, minting delegation,
     acceptance/preapproval and automation prerequisites. Determine whether
     those prerequisites hold for external Loop users or remain unverified.
   - Traffic funding, replenishment and monitoring; read-only availability of
     relevant app-provider traffic/balance data without exposing unrelated users.
   - Distinguish database allocation, coupon assignment, minting and confirmed
     transfer. A BeneficiarySplit alone is not a CC payment mechanism.
   - Do not assume POST /v0/events is supported. Identify the actual installed
     Scan/ledger read path, or flag this compatibility gap.
   - Missing FeaturedApp eligibility is a separate reward-economics issue;
     do not automatically label the staking lifecycle impossible because of it.

8. Operational and preservation requirements
   - Available CPU, RAM and disk, resource limits, database connectivity/pool
     constraints, log retention, exposed metrics and current monitoring.
   - Existing backup locations/references, latest successful backup and documented
     restore verification; do not perform a backup/restore or restart here.
   - Credential rotation, upgrades/resets/migrations and traffic outage handling.
   - Identify existing MainNet app contracts/records that need preserving. Do not
     propose copying TestNet identities, credentials or contracts into MainNet.
   - The app's old LocalNet position exits require app-server coordination;
     node inspection alone cannot prove those records are preserved after cutover.

REPORT FORMAT
Write the Markdown handoff with these sections:
1. Executive summary: VERIFIED, MISSING, UNSAFE and UNKNOWN findings.
2. Network identity and endpoint table with evidence/time/reachability scope.
3. Authentication/access controls and secure credential references.
4. Application parties, packages, vetting and relevant contract inventory.
5. Loop signing/hosting and external approval prerequisites.
6. CC collection/payment capability versus missing integration.
7. Operational readiness and preservation requirements.
8. Exact remaining actions, separated by node operator, app team and Five North.

Include this copyable NON-SECRET configuration handoff. Use verified full values
or MISSING/UNKNOWN, never placeholders presented as real configuration:

CANTON_NETWORK=mainnet
CANTON_JSON_API_URL=
CANTON_DELEGATOR_JSON_API_URL=
CANTON_USER_ID=
CANTON_DELEGATOR_USER_ID=
CANTON_SYNCHRONIZER_ID=
CANTON_PACKAGE_ID=
CANTON_MODERN_EVENT_FORMAT=
CANTON_WRITE_ACCESS_PROTECTED=
CANTON_APP_PROVIDER_PARTY=
CANTON_TREASURY_PARTY=
BENEFICIARY_SPLIT_CID=
FEATURED_APP_RIGHT_CID=
SCAN_API_URL=
VALIDATOR_API_URL=
WALLET_UI_URL=
GRPC_LEDGER_API_URL=
PARTICIPANT_ID=
DSO_PARTY=
MIGRATION_ID=
LOOP_MAINNET_HOSTING_STATUS=
LOOP_EXACT_PACKAGE_APPROVAL_STATUS=

These are handoff fields, not an instruction to apply them. Some are inventory
metadata rather than existing application environment variables. Record any
service-user field that is not applicable to genuine external users as N/A with
an explanation; never substitute the hosted delegator. The write-protection
field must distinguish verified authentication/IP restriction from UNKNOWN,
not silently default to true. Keep LOOP_STAKING_ENABLED=false and do not assign
LOOP_REVIEWED_PACKAGE_ID without actual exact-package approval evidence.

End your reply with the report path and a concise list of the blockers. Do not
claim end-to-end readiness unless actual external signing, funded lifecycle,
preservation and payment evidence exist. Collect information only; implement
nothing on the node during this task.
```
