/**
 * Thin client over the Canton JSON Ledger API.
 *
 * Docs:
 *   https://docs.digitalasset.com/build/3.5/quickstart/tutorials/using-the-json-ledger-api.html
 *
 * Endpoints used:
 *   POST /v2/commands/submit-and-wait-for-transaction
 *   POST /v2/state/active-contracts
 *
 * The JSON API speaks in terms of templateIds, choices, and party-filtered views.
 * We keep this minimal — no fancy schema validation, just typed wrappers.
 */
import { config } from "./config.js";

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

class CantonClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
    private readonly party: string
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      h["Authorization"] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  /**
   * Exercise a choice on an existing contract.
   */
  async exerciseChoice<T = unknown>(args: {
    templateId: string;
    contractId: string;
    choice: string;
    argument: Record<string, unknown>;
    actAs?: string[];
  }): Promise<SubmitAndWaitResult> {
    const body = {
      commands: {
        commands: [
          {
            ExerciseCommand: {
              templateId: args.templateId,
              contractId: args.contractId,
              choice: args.choice,
              choiceArgument: args.argument,
            },
          },
        ],
        commandId: `cantonstake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        actAs: args.actAs ?? [this.party],
        readAs: [],
        workflowId: "cantonstake",
        deduplicationPeriod: { Empty: {} },
        disclosedContracts: [],
        domainId: "",
        packageIdSelectionPreference: [],
      },
    };

    const res = await fetch(
      `${this.baseUrl}/v2/commands/submit-and-wait-for-transaction`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Canton exercise failed (${res.status}): ${errText}`);
    }
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
    const body = {
      commands: {
        commands: [
          {
            CreateCommand: {
              templateId: args.templateId,
              createArguments: args.argument,
            },
          },
        ],
        commandId: `cantonstake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        actAs: args.actAs ?? [this.party],
        readAs: [],
        workflowId: "cantonstake",
        deduplicationPeriod: { Empty: {} },
        disclosedContracts: [],
        domainId: "",
        packageIdSelectionPreference: [],
      },
    };

    const res = await fetch(
      `${this.baseUrl}/v2/commands/submit-and-wait-for-transaction`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Canton create failed (${res.status}): ${errText}`);
    }
    return normalizeSubmitResult(await res.json());
  }

  private async ledgerEndOffset(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
      method: "GET",
      headers: this.headers(),
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

  /**
   * Query active contracts for a given template.
   */
  async activeContracts(templateId: string): Promise<ActiveContract[]> {
    const activeAtOffset = await this.ledgerEndOffset();
    const body = {
      filter: {
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
      },
      verbose: false,
      activeAtOffset,
    };

    const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
      method: "POST",
      headers: this.headers(),
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

function urlWithPort(rawUrl: string, port: string): string {
  try {
    const url = new URL(rawUrl);
    url.port = port;
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.replace(/:\d+(?=\/|$)/, `:${port}`);
  }
}

export const canton = new CantonClient(
  config.cantonJsonApiUrl,
  config.cantonAuthToken,
  config.cantonAppProviderParty
);

export const cantonDelegator = new CantonClient(
  urlWithPort(config.cantonJsonApiUrl, "2975"),
  config.cantonDelegatorAuthToken,
  config.cantonDelegatorParty
);

// Template IDs — replace with your actual package id after `daml build`.
// Get it from `daml damlc inspect-dar .daml/dist/cantonstake-0.0.1.dar | head -20`
export const TEMPLATES = {
  StakingRequest:           "#cantonstake:CantonStake.Staking:StakingRequest",
  StakingPosition:          "#cantonstake:CantonStake.Staking:StakingPosition",
  BeneficiarySplit:         "#cantonstake:CantonStake.Staking:BeneficiarySplit",
  BeneficiarySplitUpdated:  "#cantonstake:CantonStake.Staking:BeneficiarySplitUpdated",
  OnchainEvent:             "#cantonstake:CantonStake.Staking:OnchainEvent",
} as const;
