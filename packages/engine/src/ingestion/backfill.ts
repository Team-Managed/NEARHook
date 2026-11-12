import type { Network, BlockEnvelope } from "../types.js";
import { normalizeNeardataBlock } from "./normalize.js";

export interface FastnearHttpOptions {
  network: Network;
  baseUrl?: string;
  apiKey?: string;
  fetcher?: typeof fetch;
}

function defaultBaseUrl(network: Network): string {
  return network === "mainnet" ? "https://mainnet.neardata.xyz" : "https://testnet.neardata.xyz";
}

export class HttpBlockBackfiller {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: FastnearHttpOptions) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl(options.network)).replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
  }

  public async getLatestHeight(signal?: AbortSignal): Promise<number> {
    const response = await this.fetcher(`${this.baseUrl}/v0/last_block/optimistic`, {
      headers: this.headers(),
      ...(signal ? { signal } : {}),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`FastNear head request failed with HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") throw new TypeError("FastNear head response was not a block object");
    const record = body as Record<string, unknown>;
    const block = record.block;
    const header = block !== null && typeof block === "object"
      ? (block as Record<string, unknown>).header
      : undefined;
    const height = header !== null && typeof header === "object"
      ? (header as Record<string, unknown>).height
      : record.height;
    const parsed = typeof height === "number" ? height : Number(height);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("FastNear head response had no valid height");
    return parsed;
  }

  public async getBlock(height: number, signal?: AbortSignal): Promise<BlockEnvelope | null> {
    if (!Number.isSafeInteger(height) || height < 0) throw new RangeError("Block height must be a non-negative integer");
    const response = await this.fetcher(`${this.baseUrl}/v0/block_opt/${height}`, {
      headers: this.headers(),
      ...(signal ? { signal } : {}),
      redirect: "follow",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`FastNear block ${height} request failed with HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (body === null) return null;
    const block = normalizeNeardataBlock(body);
    if (block.height !== height) throw new Error(`FastNear returned height ${block.height} for requested block ${height}`);
    return block;
  }

  public async backfill(startHeight: number, endHeight: number, signal?: AbortSignal): Promise<BlockEnvelope[]> {
    if (endHeight < startHeight) return [];
    const blocks: BlockEnvelope[] = [];
    for (let height = startHeight; height <= endHeight; height++) {
      if (signal?.aborted) throw signal.reason ?? new Error("Backfill was aborted");
      const block = await this.getBlock(height, signal);
      if (!block) throw new Error(`FastNear has no block at height ${height}; contiguous checkpoint was not advanced`);
      blocks.push(block);
    }
    return blocks;
  }

  private headers(): HeadersInit {
    return this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {};
  }
}
