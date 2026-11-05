import type { DirectClient, DirectRequestGuard, JsonRecord } from "./client";
import { records } from "./mapping";

/** Reserved for contract-test campaigns; the service names its campaigns «[Импульс] …». */
export const CONTRACT_PREFIX = "impuls-contract-";

export class ContractGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractGuardError";
  }
}

/** Services and methods a contract run may call at all; anything else is refused before it is sent. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  clients: ["get"],
  dictionaries: ["get"],
  changes: ["checkCampaigns"],
  reports: ["get"],
  bidmodifiers: ["get"],
  campaigns: ["get", "add", "update", "suspend", "resume", "delete"],
  adgroups: ["get", "add"],
  keywords: ["get", "add"],
  ads: ["get", "add", "update", "suspend", "resume"],
  // A picture in the advertiser's library is not shown anywhere until an ad uses it.
  adimages: ["add"],
};

const ids = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : []);

const selectionIds = (params: JsonRecord): number[] => {
  const selection = params.SelectionCriteria;
  return typeof selection === "object" && selection !== null ? ids((selection as JsonRecord).Ids) : [];
};

const addedIds = (result: JsonRecord): number[] => ids(records(result.AddResults).map((r) => r.Id));

/**
 * Keeps Direct contract tests away from everything they did not create (testing-harness spec): the account is a
 * real one and may hold live campaigns. Never sends anything to moderation, so test campaigns stay unserved drafts.
 */
export class ContractGuard implements DirectRequestGuard {
  private readonly campaigns = new Set<number>();
  private readonly adGroups = new Set<number>();
  private readonly ads = new Set<number>();
  /** Prefixed drafts left by interrupted runs, seen in a `Campaigns.get` result; they may only be deleted. */
  private readonly leftovers = new Set<number>();

  before(service: string, method: string, params: JsonRecord): void {
    if (!(ALLOWED[service] ?? []).includes(method)) {
      throw new ContractGuardError(`Contract tests may not call ${service}.${method}`);
    }
    if (method === "get" || service === "clients" || service === "dictionaries" || service === "changes" || service === "reports") {
      return;
    }
    if (service === "campaigns" && method === "add") {
      for (const item of records(params.Campaigns)) {
        if (typeof item.Name !== "string" || !item.Name.startsWith(CONTRACT_PREFIX)) {
          throw new ContractGuardError(`Contract campaigns must be named ${CONTRACT_PREFIX}…`);
        }
      }
      return;
    }
    if (service === "campaigns") {
      const targets = method === "update" ? ids(records(params.Campaigns).map((c) => c.Id)) : selectionIds(params);
      const allowed = method === "delete" ? (id: number) => this.campaigns.has(id) || this.leftovers.has(id) : (id: number) => this.campaigns.has(id);
      this.requireAll(targets, allowed, `campaigns.${method}`);
      return;
    }
    if (service === "adgroups") {
      this.requireAll(ids(records(params.AdGroups).map((g) => g.CampaignId)), (id) => this.campaigns.has(id), "adgroups.add");
      return;
    }
    if (service === "adimages") {
      const images = records(params.AdImages);
      if (images.length === 0 || images.some((image) => typeof image.Name !== "string" || !image.Name.startsWith(CONTRACT_PREFIX))) {
        throw new ContractGuardError(`Contract pictures must be named ${CONTRACT_PREFIX}…`);
      }
      return;
    }
    if (service === "keywords") {
      this.requireAll(ids(records(params.Keywords).map((k) => k.AdGroupId)), (id) => this.adGroups.has(id), "keywords.add");
      return;
    }
    // ads
    if (method === "add") {
      this.requireAll(ids(records(params.Ads).map((a) => a.AdGroupId)), (id) => this.adGroups.has(id), "ads.add");
      return;
    }
    const targets = method === "update" ? ids(records(params.Ads).map((a) => a.Id)) : selectionIds(params);
    this.requireAll(targets, (id) => this.ads.has(id), `ads.${method}`);
  }

  after(service: string, method: string, _params: JsonRecord, result: JsonRecord): void {
    if (method === "add") {
      const target = service === "campaigns" ? this.campaigns : service === "adgroups" ? this.adGroups : service === "ads" ? this.ads : null;
      for (const id of addedIds(result)) {
        target?.add(id);
      }
    }
    if (service === "campaigns" && method === "get") {
      for (const campaign of records(result.Campaigns)) {
        if (typeof campaign.Id === "number" && typeof campaign.Name === "string" && campaign.Name.startsWith(CONTRACT_PREFIX) && campaign.Status === "DRAFT") {
          this.leftovers.add(campaign.Id);
        }
      }
    }
  }

  /** Campaigns this run created; the cleanup deletes them. */
  ownCampaigns(): number[] {
    return [...this.campaigns];
  }

  private requireAll(targets: readonly number[], allowed: (id: number) => boolean, what: string): void {
    if (targets.length === 0) {
      throw new ContractGuardError(`${what} without explicit object ids is refused`);
    }
    const foreign = targets.filter((id) => !allowed(id));
    if (foreign.length > 0) {
      throw new ContractGuardError(`${what} refused for objects not created by this run: ${foreign.join(", ")}`);
    }
  }
}

/**
 * Checks the account before the first write (testing-harness spec): the token must belong to the configured test
 * login, the account must be a RUB advertiser account, and the application must be approved for the API.
 * VERIFY: `Clients.get` field values (`Type`, `Currency`) against the first approved run.
 */
export const preflightContractAccount = async (client: DirectClient, expectedLogin: string): Promise<void> => {
  let result: JsonRecord;
  try {
    result = await client.call("clients", "get", { FieldNames: ["Login", "Currency", "Type"] }, true);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "DIRECT_APP_NOT_APPROVED") {
      throw new ContractGuardError("заявка на доступ к API Директа не одобрена (error 58): contract tests cannot run yet");
    }
    throw error;
  }
  const client0 = records(result.Clients)[0];
  if (!client0) {
    throw new ContractGuardError("Clients.get returned no client for the contract token");
  }
  const login = typeof client0.Login === "string" ? client0.Login : "";
  if (login.toLowerCase() !== expectedLogin.toLowerCase()) {
    throw new ContractGuardError(`The contract token belongs to ${login || "an unknown login"}, not to DIRECT_CONTRACT_LOGIN=${expectedLogin}`);
  }
  if (client0.Currency !== "RUB") {
    throw new ContractGuardError(`The test account currency is ${String(client0.Currency)}, not RUB`);
  }
  if (client0.Type === "AGENCY") {
    throw new ContractGuardError("The test account is an agency account");
  }
};
