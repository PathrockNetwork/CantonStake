import { CantonClient, type ActiveContract, type SubmitAndWaitResult } from "./canton-ledger-client.js";

type Choice = Parameters<CantonClient["exerciseChoice"]>[0];
type Origin = "primary" | "legacy";
const templateName = (id: string) => id.split(":").slice(-2).join(":");

/** Preserve real pre-cutover contracts without copying parties/CIDs or signing
 * new user requests through a hosted identity. New creates go only to primary. */
export class CantonCutoverClient {
  private readonly origins = new Map<string, { origin: Origin; templateId: string }>();
  constructor(private readonly primary: CantonClient, private readonly legacy: CantonClient) {}

  assertCanSubmit(): void { this.primary.assertCanSubmit(); this.legacy.assertCanSubmit(); }
  async probe(signal?: AbortSignal): Promise<void> {
    await Promise.all([this.primary.probe(signal), this.legacy.probe(signal)]);
  }

  private remember(contractId: string, origin: Origin, templateId: string) {
    const old = this.origins.get(contractId);
    if (old && (old.origin !== origin || old.templateId !== templateId)) {
      throw new Error("Canton contract origin is ambiguous; refusing to route a write");
    }
    if (!old && this.origins.size >= 4096) this.origins.delete(this.origins.keys().next().value!);
    this.origins.set(contractId, { origin, templateId });
  }

  async activeContracts(templateId: string, signal?: AbortSignal): Promise<ActiveContract[]> {
    // Both views must succeed. Never silently hide existing positions when
    // LocalNet is unavailable, or fall back to legacy when primary is down.
    const batches = await Promise.all([this.primary.activeContracts(templateId, signal), this.legacy.activeContracts(templateId, signal)]);
    return batches.flatMap((batch, index) => batch.map(contract => {
      const origin: Origin = index === 0 ? "primary" : "legacy";
      this.remember(contract.contractId, origin, contract.templateId);
      return { ...contract, ledgerOrigin: origin };
    }));
  }

  async exerciseChoice(args: Choice): Promise<SubmitAndWaitResult> {
    let record = this.origins.get(args.contractId);
    if (!record) {
      await this.activeContracts(args.templateId);
      record = this.origins.get(args.contractId);
    }
    if (!record || templateName(record.templateId) !== templateName(args.templateId)) {
      throw new Error("Canton contract origin cannot be independently resolved; no write was submitted");
    }
    const client = record.origin === "legacy" ? this.legacy : this.primary;
    // Use the source's actual package, service user, synchronizer and provider.
    const result = await client.exerciseChoice({ ...args, templateId: record.templateId });
    for (const item of result.events) {
      const row = item as Record<string, any>;
      const created = row?.CreatedEvent ?? row?.createdEvent ?? row?.event?.CreatedEvent ?? row?.event?.createdEvent;
      if (typeof created?.contractId === "string" && typeof created?.templateId === "string") {
        this.remember(created.contractId, record.origin, created.templateId);
      }
    }
    return result;
  }

  createContract(args: Parameters<CantonClient["createContract"]>[0]) { return this.primary.createContract(args); }
  contractHistory(...args: Parameters<CantonClient["contractHistory"]>) { return this.primary.contractHistory(...args); }
  transactionById(...args: Parameters<CantonClient["transactionById"]>) { return this.primary.transactionById(...args); }
  transactionAtOffset(...args: Parameters<CantonClient["transactionAtOffset"]>) { return this.primary.transactionAtOffset(...args); }
}
