# Canton MainNet validator server prompt

Copy the prompt below into the agent connected to the existing MainNet validator server.

```text
We already have a Canton MainNet validator running on this server. We want to connect CantonStake at:

https://cantonstake.pathrocknetwork.org

Perform a read-only inspection of the existing deployment and create:
/tmp/cantonstake-mainnet-node-handoff.md

Do not reinstall services, change configuration, restart containers, allocate parties, upload packages, claim rewards or transfer funds. Do not print tokens, private keys, passwords, seed phrases or client secrets. Report credential locations or secret-manager references instead, with sensitive URL parameters redacted.

Inspect the deployment and report:

1. Network identity and health:
   - Confirm this is Canton MainNet, independently of container names.
   - Validator name, participant ID, synchronizer ID and DSO party ID.
   - Canton, Splice and JSON Ledger API versions.
   - Current synchronization and service health.

2. Connection details:
   - Actual JSON Ledger API base URL.
   - Participant endpoint for user/delegator submissions, if different.
   - Validator/wallet API and Scan or Scan-proxy URLs.
   - Private routing, TLS and application-server allowlist requirements.
   - Which endpoints are reachable only locally.

3. Authentication and authorization:
   - Identity-provider issuer, token endpoint, JWKS and API audiences.
   - Dedicated CantonStake service-user availability.
   - Token renewal method and credential references.
   - Existing relevant actAs/read permissions.
   - Supported production user-party authorization and external-signing model.

4. Application setup:
   - Existing CantonStake provider and treasury parties.
   - Installed CantonStake packages and dependencies.
   - Relevant BeneficiarySplit and FeaturedAppRight contracts, if present.
   - Actual app reward eligibility/registration evidence.
   - Mark missing items explicitly; do not create them.

5. Wallet and real CC payments:
   - Supported MainNet wallet providers and their API/UI URLs.
   - Supported reward observation, claim, transfer and confirmation APIs.
   - Beneficiary acceptance or transfer-preapproval requirements.
   - Traffic funding, replenishment and monitoring arrangements.
   - Distinguish existing payment capabilities from work still required.

6. Compatibility:
   - Availability of JSON Ledger API v2 ledger-end, active-contract queries
     and submit-and-wait-for-transaction.
   - Required command fields and synchronizer routing.
   - Whether Scan supports POST /v0/events with app_activity_records;
     provide the supported alternative if it does not.
   - The application supports explicit provider/delegator URLs, service user,
     synchronizer and package routing; its legacy port-2975 fallback and shared
     hosted delegator are not an external user signing model. MainNet external
     Loop staking is deliberately blocked. Identify the production configuration,
     exact-DAR approval and external-party authorization/hosting changes needed.
   - Its current reward processor records database allocations; this does
     not establish that real CC payments have occurred.

7. Operational readiness:
   - Available CPU, RAM and disk headroom.
   - Backup and restore readiness, log retention and monitoring.
   - Credential rotation, maintenance and upgrade arrangements.

Separate verified findings, missing information and required integration changes.
Include a compact configuration handoff table with non-secret values and the
remaining actions needed before a controlled production integration test.
```
