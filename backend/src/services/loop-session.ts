import { config } from "../config.js";
import { isCantonParty } from "./canton-network.js";

export class LoopSessionError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

/** Authentication is independent of permission to create on-ledger stakes. */
export async function verifyLoopIdentitySession(authorization: string | undefined, expectedParty: string): Promise<void> {
  if (!authorization || !/^Bearer [^\s]{1,8192}$/.test(authorization) || !isCantonParty(expectedParty)) {
    throw new LoopSessionError(401, `A verified Loop wallet session on ${config.cantonNetworkInfo.label} is required`);
  }
  let response: Response;
  try {
    response = await fetch(`${config.cantonNetworkInfo.loopOrigin}/api/v1/.connect/pair/account`, {
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
  } catch { throw new LoopSessionError(503, "Loop session verification is unavailable"); }
  if ([400, 401, 403, 404].includes(response.status)) throw new LoopSessionError(401, "Loop session expired or was rejected; reconnect your wallet");
  if (!response.ok) throw new LoopSessionError(503, "Loop session verification is unavailable");
  let account: { party_id?: string; public_key?: string };
  try { account = await response.json(); } catch { throw new LoopSessionError(503, "Loop returned an invalid account response"); }
  if (account.party_id !== expectedParty || typeof account.public_key !== "string" || !account.public_key.trim()) throw new LoopSessionError(403, "The verified Loop party does not match this account");
}
