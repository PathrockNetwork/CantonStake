/** Splice token-standard registry (CIP-0056) client. Read-only HTTP; never sends ledger credentials. */
import { isContractId } from "./canton-network.js";
import type { DisclosedContract } from "./canton-ledger-client.js";

export interface ChoiceContext { choiceContextData: Record<string, unknown>; disclosedContracts: DisclosedContract[] }
export interface TransferFactory { factoryId: string; transferKind: "self" | "direct" | "offer"; choiceContext: ChoiceContext }

function validContext(value: unknown): value is ChoiceContext {
  const ctx = value as ChoiceContext | undefined;
  return !!ctx && typeof ctx.choiceContextData === "object" && ctx.choiceContextData !== null &&
    Array.isArray(ctx.disclosedContracts) && ctx.disclosedContracts.length <= 50 &&
    ctx.disclosedContracts.every(d => isContractId(d.contractId) &&
      typeof d.createdEventBlob === "string" && d.createdEventBlob.length > 0 && typeof d.synchronizerId === "string");
}

export class TokenRegistry {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    if (new URL(baseUrl).protocol !== "https:") throw new Error("Token registry URL must use HTTPS");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Token registry ${path.split("/").slice(-1)[0]} failed (${res.status})`);
    return res.json();
  }

  async transferFactory(choiceArguments: Record<string, unknown>): Promise<TransferFactory> {
    const result = await this.post("/registry/transfer-instruction/v1/transfer-factory",
      { choiceArguments, excludeDebugFields: true }) as TransferFactory;
    if (!result || !isContractId(result.factoryId) ||
        !["self", "direct", "offer"].includes(result.transferKind) || !validContext(result.choiceContext)) {
      throw new Error("Token registry returned a malformed transfer factory");
    }
    return result;
  }

  async instructionContext(instructionId: string, choice: "accept" | "reject" | "withdraw"): Promise<ChoiceContext> {
    if (!isContractId(instructionId)) throw new Error("Invalid transfer instruction ID");
    const result = await this.post(`/registry/transfer-instruction/v1/${instructionId}/choice-contexts/${choice}`,
      { meta: {}, excludeDebugFields: true });
    if (!validContext(result)) throw new Error("Token registry returned a malformed choice context");
    return result;
  }
}
