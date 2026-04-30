# Backup Demo Recording Script

Use this to record a 3-minute fallback video after the smoke test passes.

## Recording Setup

- Browser at `http://localhost:3000`.
- Terminal 1: backend logs.
- Terminal 2: short commands ready:
  ```bash
  curl http://localhost:4001/api/health/detail
  curl -X POST http://localhost:4001/api/admin/rounds/trigger
  ```
- Wallet funded on Polygon Amoy.
- `NEXT_PUBLIC_MOCK_LOOP_PARTY_ID` set to a hosted Canton party.

## Shot List

1. Home page, 15 seconds.
   Say: CantonStake connects off-Canton staking activity to on-Canton reward attribution.

2. Stake page, 45 seconds.
   Connect Loop, connect EVM wallet, stake `0.1 POL`, and show the execution trace.

3. Positions page, 35 seconds.
   Show the Bonded row, markers, and the `Sweep` button for native reward fee accounting.

4. Trigger rewards, 25 seconds.
   Run:
   ```bash
   curl -X POST http://localhost:4001/api/admin/rounds/trigger
   ```

5. Rewards page, 45 seconds.
   Show CC earned, 75/25 split, native sweep totals, and protocol fee totals.

6. Unbond, 30 seconds.
   Return to positions, click `Unbond`, and show the Unbonding state.

7. Close, 20 seconds.
   Show health detail and say which parts are mock boundaries: Loop SDK boundary, Amoy validator mock, and `demo-stub` scheduler mode.

## Notes

- If real `FeaturedAppRight` is configured, show the Daml shell marker query.
- If using `demo-stub`, say that marker exercise is disabled but reward scheduler and fee accounting are active.
- Keep the video under 3 minutes for judging flow.
