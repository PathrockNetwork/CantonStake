import { randomUUID } from "node:crypto";
import type { TokenSource } from "./canton-oauth.js";
import { isContractId } from "./canton-network.js";

export interface SubmitAndWaitResult {
  transactionId: string;
  completionOffset: string;
  events: unknown[];
}

export interface ActiveContract {
  contractId: string;
  templateId: string;
  argument: Record<string, unknown>;
}

export interface ActiveInterfaceContract {
  contractId: string;
  templateId: string;
  interfaceId: string;
  synchronizerId: string;
  signatories: string[];
  witnessParties: string[];
  view: Record<string, unknown>;
}

export interface ContractHistory {
  created?: { synchronizerId: string; createdEvent: {
    contractId: string; templateId: string; createArgument: Record<string, unknown>; offset: number;
  } };
  archived?: { synchronizerId: string; archivedEvent: {
    contractId: string; templateId: string; offset: number;
  } };
}

/** A rejected command. 4xx means the ledger definitively refused it. */
export class CantonCommandError extends Error {
  constructor(operation: string, readonly status: number, body: string) {
    super(`Canton ${operation} failed (${status}): ${body.slice(0, 2000)}`);
    this.name = "CantonCommandError";
  }
}

export interface DisclosedContract { templateId?: string; contractId: string; createdEventBlob: string; synchronizerId: string }

/** Contracts created by a submitted command, in event order. */
export function createdContracts(events: unknown[]): Array<{ contractId: string; templateId: string }> {
  return events.flatMap(event => {
    const created = asRecord(asRecord(event)?.CreatedEvent);
    const contractId = stringValue(created?.contractId), templateId = stringValue(created?.templateId);
    return contractId && templateId ? [{ contractId, templateId }] : [];
  });
}

export interface TemplateEvent {
  kind: "created" | "archived";
  contractId: string;
  templateId: string;
  offset: number;
  effectiveAt: string | null;
  argument: Record<string, unknown> | null;
}

export interface LedgerTransaction {
  updateId: string;
  synchronizerId: string;
  events: Array<{ CreatedEvent?: { contractId: string; templateId: string }; ExercisedEvent?: {
    contractId: string; templateId: string; choice: string;
    actingParties: string[]; consuming: boolean;
  } }>;
}

/**
 * The Canton 3.5 JSON API encodes Daml Int (and Numeric) as JSON
 * *strings* — a raw JSON number in a payload fails server-side with
 * `LEDGER_API_INTERNAL_ERROR: Expected ujson.Str`. Every JS number in a
 * choice argument / create argument therefore becomes a string here,
 * centrally, rather than at each call site.
 */
function damlEncode(value: unknown): unknown {
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(damlEncode);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        damlEncode(v),
      ])
    );
  }
  return value;
}

export interface CantonClientOptions {
  userId?: string;
  synchronizerId?: string;
  /** Keep the older request shape for existing LocalNet deployments. */
  eventFormat?: boolean;
  packageId?: string;
  /** Operator attestation: the remote gateway/allowlist actually protects writes. */
  writeAccessProtected?: boolean;
}

export class CantonClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string | TokenSource,
    private readonly party: string,
    private readonly options: CantonClientOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  assertCanSubmit(): void {
    const endpoint = new URL(this.baseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(endpoint.hostname);
    if (!local && endpoint.protocol !== "https:") {
      throw new Error("Remote Canton command submission requires HTTPS");
    }
    if (!local && this.options.writeAccessProtected !== true) {
      throw new Error("Remote Canton writes are disabled: secure the Ledger API gateway or IP allowlist before setting CANTON_WRITE_ACCESS_PROTECTED=true");
    }
    if (!local && (!this.options.userId || !this.options.synchronizerId)) {
      throw new Error("Remote Canton command submission requires an explicit service user and synchronizer ID");
    }
  }

  private commandContext() {
    return {
      commandId: `cantonstake-${randomUUID()}`,
      actAs: [this.party],
      readAs: [],
      workflowId: "cantonstake",
      ...(this.options.userId ? { userId: this.options.userId } : {}),
      ...(this.options.synchronizerId ? { synchronizerId: this.options.synchronizerId } : {}),
      ...(this.options.packageId ? { packageIdSelectionPreference: [this.options.packageId] } : {}),
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const signal = init.signal ?? AbortSignal.timeout(30_000);
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: await this.headers(signal),
      // Never forward bearer credentials to a redirected endpoint.
      redirect: "error",
      signal,
    });
  }

  private async headers(signal?: AbortSignal): Promise<Record<string, string>> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = typeof this.authToken === "function" ? await this.authToken(signal) : this.authToken;
    if (token) {
      h["Authorization"] = `Bearer ${token}`;
    }
    return h;
  }

  /**
   * Exercise a choice on an existing contract.
   */
  async exerciseChoice(args: {
    templateId: string;
    contractId: string;
    choice: string;
    argument: Record<string, unknown>;
    actAs?: string[];
    /** Caller-chosen ID so a retry is deduplicated by the ledger, not executed twice. */
    commandId?: string;
    /** Registry-supplied contracts this party cannot see itself. */
    disclosedContracts?: DisclosedContract[];
    signal?: AbortSignal;
  }): Promise<SubmitAndWaitResult> {
    this.assertCanSubmit();
    const body = {
      commands: {
        ...this.commandContext(),
        ...(args.commandId ? { commandId: args.commandId } : {}),
        ...(args.disclosedContracts ? { disclosedContracts: args.disclosedContracts } : {}),
        commands: [
          {
            ExerciseCommand: {
              templateId: args.templateId,
              contractId: args.contractId,
              choice: args.choice,
              choiceArgument: damlEncode(args.argument),
            },
          },
        ],
        actAs: args.actAs ?? [this.party],
      },
    };

    const res = await this.request(
      "/v2/commands/submit-and-wait-for-transaction",
      {
        method: "POST",
        body: JSON.stringify(body),
        signal: args.signal,
      }
    );

    if (!res.ok) throw new CantonCommandError("exercise", res.status, await res.text());
    return normalizeSubmitResult(await res.json());
  }

  /**
   * Create a new contract on the ledger.
   */
  async createContract(args: {
    templateId: string;
    argument: Record<string, unknown>;
    actAs?: string[];
  }): Promise<SubmitAndWaitResult> {
    this.assertCanSubmit();
    const body = {
      commands: {
        ...this.commandContext(),
        commands: [
          {
            CreateCommand: {
              templateId: args.templateId,
              createArguments: damlEncode(args.argument),
            },
          },
        ],
        actAs: args.actAs ?? [this.party],
      },
    };

    const res = await this.request(
      "/v2/commands/submit-and-wait-for-transaction",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) throw new CantonCommandError("create", res.status, await res.text());
    return normalizeSubmitResult(await res.json());
  }

  private async ledgerEndOffset(signal?: AbortSignal): Promise<string> {
    const res = await this.request("/v2/state/ledger-end", {
      signal,
      method: "GET",
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Canton ledger-end failed (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const offset = findString(json, [
      "offset",
      "ledgerEnd",
      "ledgerEndOffset",
      "currentLedgerEnd",
      "absolute",
    ]);
    if (!offset) {
      throw new Error(`Canton ledger-end response missing offset: ${JSON.stringify(json)}`);
    }
    return offset;
  }

  /** Lightweight authenticated readiness check; does not scan contracts. */
  async probe(signal?: AbortSignal): Promise<void> {
    await this.ledgerEndOffset(signal);
  }

  /** Events visible to this party; a package-name template narrows them, none means any template. */
  private historyEventFormat(templateId?: string) {
    const identifierFilter = templateId
      ? { TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } } }
      : { WildcardFilter: { value: { includeCreatedEventBlob: false } } };
    return { filtersByParty: { [this.party]: { cumulative: [{ identifierFilter }] } }, verbose: true };
  }

  /** Current ledger end; the exclusive start for the next update page. */
  async ledgerEnd(signal?: AbortSignal): Promise<number> {
    const offset = Number(await this.ledgerEndOffset(signal));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Canton ledger offset is not a safe nonnegative integer");
    return offset;
  }

  /** One page of create/archive events for a template visible to this party,
   * in offset order. Contracts collected within minutes still appear here,
   * unlike in an ACS snapshot. */
  async templateEvents(templateId: string, beginExclusive: number, endInclusive: number, limit = 200,
    signal?: AbortSignal): Promise<{ events: TemplateEvent[]; lastOffset: number | null }> {
    const response = await this.request(`/v2/updates?limit=${limit}`, {
      method: "POST", signal,
      body: JSON.stringify({ beginExclusive, endInclusive, verbose: false, updateFormat: { includeTransactions: {
        transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
        eventFormat: { filtersByParty: { [this.party]: { cumulative: [{ identifierFilter: {
          TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } },
        } }] } }, verbose: false },
      } } }),
    });
    if (!response.ok) throw new Error(`Canton update stream unavailable (${response.status})`);
    const updates: unknown = await response.json();
    if (!Array.isArray(updates) || updates.length > limit) throw new Error("Canton update page is malformed");
    const events: TemplateEvent[] = [];
    let lastOffset: number | null = null;
    for (const item of updates) {
      const update = asRecord(asRecord(item)?.update);
      const tx = asRecord(asRecord(update?.Transaction)?.value);
      const checkpoint = asRecord(asRecord(update?.OffsetCheckpoint)?.value);
      const offset = Number(tx?.offset ?? checkpoint?.offset);
      if (!Number.isSafeInteger(offset)) continue;
      lastOffset = offset;
      if (!tx || !Array.isArray(tx.events)) continue;
      for (const raw of tx.events) {
        const created = asRecord(asRecord(raw)?.CreatedEvent), archived = asRecord(asRecord(raw)?.ArchivedEvent);
        const event = created ?? archived;
        const contractId = stringValue(event?.contractId), eventTemplate = stringValue(event?.templateId);
        if (!contractId || !eventTemplate) continue;
        events.push({ kind: created ? "created" : "archived", contractId, templateId: eventTemplate, offset,
          effectiveAt: stringValue(tx.effectiveAt) ?? null, argument: asRecord(created?.createArgument) ?? null });
      }
    }
    return { events, lastOffset };
  }

  /** Read-only view including archived contracts, unlike an ACS query. Without a template, any visible template matches. */
  async contractHistory(contractId: string, templateId?: string, signal?: AbortSignal): Promise<ContractHistory | null> {
    if (!isContractId(contractId)) throw new Error("Invalid Canton contract ID");
    const eventFormat = this.historyEventFormat(templateId);
    const response = await this.request("/v2/events/events-by-contract-id", {
      method: "POST", signal,
      body: JSON.stringify({ contractId, eventFormat }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Canton contract history unavailable (${response.status})`);
    return await response.json() as ContractHistory;
  }

  /** Modern Canton 3.5 ledger-effects view, not deprecated transaction trees. */
  async transactionAtOffset(offset: number, templateId?: string, signal?: AbortSignal): Promise<LedgerTransaction | null> {
    if (!Number.isSafeInteger(offset) || offset <= 0) throw new Error("Invalid Canton transaction offset");
    return this.readLedgerEffects("offset", offset, templateId, signal);
  }

  async transactionById(updateId: string, templateId?: string, signal?: AbortSignal): Promise<LedgerTransaction | null> {
    if (!/^[A-Za-z0-9._:#-]{1,255}$/.test(updateId)) throw new Error("Invalid Canton update ID");
    return this.readLedgerEffects("id", updateId, templateId, signal);
  }

  private async readLedgerEffects(kind: "offset" | "id", value: number | string, templateId: string | undefined,
    signal?: AbortSignal): Promise<LedgerTransaction | null> {
    const response = await this.request(`/v2/updates/update-by-${kind}`, {
      method: "POST", signal,
      body: JSON.stringify({ [kind === "id" ? "updateId" : "offset"]: value, updateFormat: { includeTransactions: {
        transactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS", eventFormat: this.historyEventFormat(templateId),
      } } }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Canton transaction observation unavailable (${response.status})`);
    const result = await response.json() as { update?: { Transaction?: { value?: LedgerTransaction } } };
    return result.update?.Transaction?.value ?? null;
  }

  /**
   * Query active contracts for a given template.
   */
  async activeContracts(templateId: string, signal?: AbortSignal): Promise<ActiveContract[]> {
    const activeAtOffset = await this.ledgerEndOffset(signal);
    const filter = {
        filtersByParty: {
          [this.party]: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: { templateId, includeCreatedEventBlob: false },
                  },
                },
              },
            ],
          },
        },
    };

    const offset = Number(activeAtOffset);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Canton ledger offset is not a safe nonnegative integer");
    }
    const body = this.options.eventFormat
      ? { activeAtOffset: offset, eventFormat: { ...filter, verbose: false } }
      : { activeAtOffset: offset, filter, verbose: false };

    const res = await this.request("/v2/state/active-contracts", {
      signal,
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Canton ACS query failed (${res.status}): ${errText}`);
    }

    const json = await res.json();

    // Canton JSON API v2 returns either { contractEntries: [...] } or a flat array
    const entries: Array<Record<string, unknown>> = Array.isArray(json)
      ? json
      : (json as Record<string, unknown>).contractEntries != null
        ? ((json as Record<string, unknown>).contractEntries as Array<Record<string, unknown>>)
        : [];

    return entries
      .map(extractCreatedEvent)
      .filter((e): e is CreatedEvent => e !== undefined)
      .map((e) => ({
        contractId: e.contractId,
        templateId: e.templateId,
        argument: e.createArgument,
      }));
  }

  /** Modern interface ACS read at one explicit ledger offset. A failed view
   * must not be silently discarded and reported as zero reward entitlement.
   * Never queries as another party, discloses contracts or submits commands. */
  async activeInterfaceSnapshot(interfaceId: string, signal?: AbortSignal): Promise<{
    offset: string; contracts: ActiveInterfaceContract[];
  }> {
    if (!this.options.eventFormat || !/^#[a-zA-Z0-9._-]+:[a-zA-Z0-9._]+:[a-zA-Z0-9._]+$/.test(interfaceId)) {
      throw new Error("Interface observation requires a modern Canton API and package-name identifier");
    }
    const offset = await this.ledgerEndOffset(signal);
    const numericOffset = Number(offset);
    if (!Number.isSafeInteger(numericOffset) || numericOffset < 0) throw new Error("Canton interface snapshot offset is invalid");
    const response = await this.request("/v2/state/active-contracts", { method: "POST", signal,
      body: JSON.stringify({ activeAtOffset: numericOffset, eventFormat: {
        filtersByParty: { [this.party]: { cumulative: [{ identifierFilter: { InterfaceFilter: { value: {
          interfaceId, includeInterfaceView: true, includeCreatedEventBlob: false,
        } } } }] } }, verbose: false,
      } }),
    });
    if (!response.ok) throw new Error(`Canton interface observation unavailable (${response.status})`);
    const result: unknown = await response.json();
    const entries = Array.isArray(result) ? result : asRecord(result)?.contractEntries;
    if (!Array.isArray(entries) || entries.length > 10000) throw new Error("Canton interface inventory is malformed or too large");
    const wanted = interfaceId.split(":").slice(1).join(":");
    const contracts = entries.map((item: unknown) => {
      const entry = asRecord(item);
      const active = asRecord(asRecord(entry?.contractEntry)?.JsActiveContract) ?? asRecord(entry?.activeContract);
      const created = asRecord(active?.createdEvent);
      const contractId = stringValue(created?.contractId), templateId = stringValue(created?.templateId);
      const synchronizerId = stringValue(active?.synchronizerId);
      const views = Array.isArray(created?.interfaceViews) ? created.interfaceViews : [];
      const matches = views.map(asRecord).filter(view => typeof view?.interfaceId === "string" && view.interfaceId.split(":").slice(1).join(":") === wanted);
      const matched = matches.length === 1 ? matches[0] : undefined;
      const status = asRecord(matched?.viewStatus), view = asRecord(matched?.viewValue);
      const signatories = created?.signatories, witnesses = created?.witnessParties;
      if (!contractId || !templateId || !synchronizerId || !/^\d+$/.test(offset) ||
          (this.options.synchronizerId && synchronizerId !== this.options.synchronizerId) || !view || status?.code !== 0 ||
          !Array.isArray(signatories) || !signatories.length || !signatories.every(party => typeof party === "string") ||
          !Array.isArray(witnesses) || !witnesses.includes(this.party)) {
        throw new Error("Canton interface view, ownership or synchronizer could not be verified");
      }
      return { contractId, templateId, synchronizerId, interfaceId: String(matched!.interfaceId),
        signatories: signatories as string[], witnessParties: witnesses as string[], view };
    });
    if (new Set(contracts.map(contract => contract.contractId)).size !== contracts.length) throw new Error("Canton interface inventory has duplicate contracts");
    return { offset, contracts };
  }
}

interface CreatedEvent {
  contractId: string;
  templateId: string;
  createArgument: Record<string, unknown>;
}

function normalizeSubmitResult(json: unknown): SubmitAndWaitResult {
  const root = asRecord(json) ?? {};
  const transaction = asRecord(root.transaction) ?? {};
  const completion = asRecord(root.completion) ?? {};
  const events = Array.isArray(root.events)
    ? root.events
    : Array.isArray(transaction.events)
    ? transaction.events
    : [];

  return {
    transactionId:
      stringValue(root.transactionId) ??
      stringValue(root.updateId) ??
      stringValue(transaction.transactionId) ??
      stringValue(transaction.updateId) ??
      stringValue(completion.transactionId) ??
      stringValue(completion.updateId) ??
      "",
    completionOffset:
      stringValue(root.completionOffset) ??
      stringValue(transaction.offset) ??
      stringValue(completion.offset) ??
      "",
    events,
  };
}

function extractCreatedEvent(entry: Record<string, unknown>): CreatedEvent | undefined {
  const contractEntry = asRecord(entry.contractEntry) ?? {};
  const activeContract = asRecord(entry.activeContract) ?? {};
  const jsActiveContract = asRecord(contractEntry.JsActiveContract) ?? {};
  const createdEvent =
    asRecord(activeContract.createdEvent) ??
    asRecord(jsActiveContract.createdEvent) ??
    asRecord(entry.createdEvent);

  const contractId = stringValue(createdEvent?.contractId);
  const templateId = stringValue(createdEvent?.templateId);
  const createArgument = asRecord(createdEvent?.createArgument);

  if (!contractId || !templateId || !createArgument) return undefined;
  return { contractId, templateId, createArgument };
}

function findString(value: unknown, keys: string[]): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  for (const key of keys) {
    const found = stringValue(record[key]);
    if (found) return found;
  }
  for (const child of Object.values(record)) {
    const found = findString(child, keys);
    if (found) return found;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return undefined;
}
