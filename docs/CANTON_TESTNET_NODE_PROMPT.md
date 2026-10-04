# Canton TestNet validator server prompt

Copy the prompt below into the agent connected to the existing TestNet validator server.

```text
We already have a Canton TestNet validator running on this server. We want to connect CantonStake at:

https://testnet.cantonstake.pathrocknetwork.org

Perform a read-only inspection of the existing deployment and create:
/tmp/cantonstake-testnet-node-handoff.md

Do not reinstall services, change configuration, restart containers, allocate parties, upload packages or submit transactions. Do not print tokens, private keys, passwords, seed phrases or client secrets. Report credential locations or secret-manager references instead, with sensitive URL parameters redacted.

Inspect the deployment and report:

1. Network identity and health:
   - Confirm this is Canton TestNet, independently of container names.
   - Validator name, participant ID, synchronizer ID and DSO party ID.
   - Canton, Splice and JSON Ledger API versions.
   - Current synchronization and service health.

2. Connection details:
   - Actual JSON Ledger API base URL.
   - Participant endpoint for delegator submissions, if different.
   - Validator/wallet API and Scan or Scan-proxy URLs.
   - Private routing, TLS and application-server allowlist requirements.
   - Which endpoints are reachable only locally.

3. Authentication:
   - Identity-provider issuer, token endpoint, JWKS and API audiences.
   - Dedicated application service-user availability.
   - Token renewal method and credential references.
   - Existing relevant actAs/read permissions.

4. Application setup:
   - Existing CantonStake provider, treasury and test-delegator parties.
   - Installed CantonStake packages and dependencies.
   - Relevant BeneficiarySplit and FeaturedAppRight contracts, if present.
   - Mark missing items explicitly; do not create them.

5. Wallet and CC integration:
   - Wallet providers that actually support this Canton TestNet.
   - Network identifiers and wallet API/UI URLs.
   - Supported reward, claim, transfer and confirmation APIs.
   - Existing test funding and traffic arrangements.

6. Compatibility:
   - Availability of JSON Ledger API v2 ledger-end, active-contract queries
     and submit-and-wait-for-transaction.
   - Required command fields and synchronizer routing.
   - Whether Scan supports POST /v0/events with app_activity_records;
     provide the supported alternative if it does not.
   - The application now supports explicit provider/delegator endpoint,
     service-user and synchronizer routing and Loop TestNet configuration.
     Its existing deployment still uses LocalNet and Loop DevNet; these are
     not Canton TestNet. Identify the verified remote endpoints and external
     user signing/hosting path; do not substitute the hosted test-delegator
     service identity for a genuine Loop user.

7. Operational readiness:
   - Available CPU, RAM and disk headroom.
   - Backup, log-retention and monitoring status.
   - TestNet reset/upgrade recovery arrangements.

Separate verified findings, missing information and required integration changes.
Include a compact configuration handoff table with non-secret values and the
exact remaining actions for the CantonStake application team.
```
