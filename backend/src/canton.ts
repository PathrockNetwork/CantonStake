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
  }): Promise<SubmitAndWaitResult> {
    const body = {
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
      actAs: [this.party],
      readAs: [],
      workflowId: "cantonstake",
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
    return (await res.json()) as SubmitAndWaitResult;
  }

  /**
   * Create a new contract on the ledger.
   */
  async createContract(args: {
    templateId: string;
    argument: Record<string, unknown>;
  }): Promise<SubmitAndWaitResult> {
    const body = {
      commands: [
        {
          CreateCommand: {
            templateId: args.templateId,
            createArguments: args.argument,
          },
        },
      ],
      commandId: `cantonstake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: [this.party],
      readAs: [],
      workflowId: "cantonstake",
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
    return (await res.json()) as SubmitAndWaitResult;
  }

  /**
   * Query active contracts for a given template.
   */
  async activeContracts(templateId: string): Promise<ActiveContract[]> {
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
      activeAtOffset: "",
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

    const json = (await res.json()) as {
      contractEntries?: Array<{
        activeContract?: {
          createdEvent?: {
            contractId: string;
            templateId: string;
            createArgument: Record<string, unknown>;
          };
        };
      }>;
    };

    return (json.contractEntries ?? [])
      .map((entry) => entry.activeContract?.createdEvent)
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((e) => ({
        contractId: e.contractId,
        templateId: e.templateId,
        argument: e.createArgument,
      }));
  }
}

export const canton = new CantonClient(
  config.cantonJsonApiUrl,
  config.cantonAuthToken,
  config.cantonAppProviderParty
);

// Template IDs — replace with your actual package id after `daml build`.
// Get it from `daml damlc inspect-dar .daml/dist/cantonstake-0.0.1.dar | head -20`
export const TEMPLATES = {
  StakingRequest: "#cantonstake:CantonStake.Staking:StakingRequest",
  StakingPosition: "#cantonstake:CantonStake.Staking:StakingPosition",
} as const;
