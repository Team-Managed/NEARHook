import type { StorageAdapter, YieldRecord } from "../types.js";

export interface YieldResumeAction {
  contract_id: string;
  method_name: "resume_action";
  args: { request_id: number; payload: string };
  gas_tgas: 30;
  deposit_yocto: "0";
  yield_token: string;
}

export interface YieldResumeDriver {
  broadcast(action: YieldResumeAction): Promise<string>;
}

function isAccountId(value: string): boolean {
  return value.length <= 64 && /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(value);
}

/** Formats the current reference contract's JSON call interface. */
export function formatYieldResumeAction(
  record: Pick<YieldRecord, "yield_token" | "request_id" | "contract_id" | "status">,
  response: unknown
): YieldResumeAction {
  if (!record.yield_token) throw new Error("Yield token is required");
  if (!Number.isSafeInteger(record.request_id) || record.request_id < 0) {
    throw new RangeError("Yield request ID must be a non-negative safe integer");
  }
  if (!isAccountId(record.contract_id)) throw new TypeError("Invalid NEAR contract account ID");
  if (record.status !== "AWAITING_WEBHOOK" && record.status !== "RESUMING") {
    throw new Error(`Yield ${record.yield_token} is not awaiting a response`);
  }
  const payload = JSON.stringify(response);
  if (payload === undefined) throw new TypeError("Webhook response must be JSON serializable");
  if (Buffer.byteLength(payload, "utf8") > 1_024) throw new RangeError("Resume payload exceeds contract limit");
  return {
    contract_id: record.contract_id,
    method_name: "resume_action",
    args: { request_id: record.request_id, payload },
    gas_tgas: 30,
    deposit_yocto: "0",
    yield_token: record.yield_token,
  };
}

export interface YieldApprovalOptions {
  storage: StorageAdapter;
  driver: YieldResumeDriver;
  currentBlock: number;
  httpStatus: number;
  now?: () => Date;
}

export async function processWebhookYieldApproval(
  yieldToken: string,
  responseBody: string,
  options: YieldApprovalOptions
): Promise<YieldRecord> {
  if (options.httpStatus < 200 || options.httpStatus >= 300) {
    throw new Error(`Webhook did not approve the yield (HTTP ${options.httpStatus})`);
  }
  if (!Number.isSafeInteger(options.currentBlock) || options.currentBlock < 0) {
    throw new RangeError("Current block height must be a non-negative safe integer");
  }
  const stored = await options.storage.getYield(yieldToken);
  if (!stored) throw new Error(`Unknown yield token: ${yieldToken}`);
  if (stored.status !== "AWAITING_WEBHOOK") {
    if (stored.status === "RESUMED") return stored;
    throw new Error(`Yield ${yieldToken} is ${stored.status.toLowerCase()}`);
  }
  if (options.currentBlock >= stored.expires_at_block) {
    const expired: YieldRecord = { ...stored, status: "EXPIRED" };
    await options.storage.updateYield(expired);
    return expired;
  }

  let response: unknown;
  try {
    response = JSON.parse(responseBody);
  } catch {
    throw new TypeError("Successful yield webhook must return a JSON response");
  }
  if (response === null || typeof response !== "object" || Array.isArray(response)) {
    throw new TypeError("Yield webhook response must be a JSON object");
  }

  const claimed = await options.storage.claimYieldForResume(yieldToken);
  if (!claimed) {
    const latest = await options.storage.getYield(yieldToken);
    if (latest?.status === "RESUMED") return latest;
    throw new Error(`Yield ${yieldToken} was already claimed for resumption`);
  }

  const action = formatYieldResumeAction(claimed, response);
  try {
    const transactionHash = await options.driver.broadcast(action);
    const resumed: YieldRecord = {
      ...claimed,
      status: "RESUMED",
      resume_payload: action.args.payload,
      resume_tx_hash: transactionHash,
      resumed_at: (options.now ?? (() => new Date()))().toISOString(),
    };
    await options.storage.updateYield(resumed);
    return resumed;
  } catch (error: unknown) {
    await options.storage.updateYield({ ...claimed, status: "AWAITING_WEBHOOK" });
    throw error;
  }
}
