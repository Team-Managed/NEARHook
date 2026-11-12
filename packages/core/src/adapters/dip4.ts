import { createHash } from "node:crypto";

export interface NormalizedOmnichainIntent {
  intent_id: string;
  source_chain: string;
  destination_chain: string;
  token_in: string;
  token_out: string;
  amount_in_raw: string;
  amount_out_raw: string;
  amount_in_formatted: string;
  amount_out_formatted: string;
  relayer?: string | undefined;
}

export interface KnownChainAsset {
  chain: string;
  symbol: string;
  /** Undefined when the asset's precision is not known. */
  decimals?: number;
}

export const DEFAULT_ASSET_REGISTRY: Readonly<Record<string, KnownChainAsset>> = {
  "sol.omft.near": { chain: "SOLANA", symbol: "SOL", decimals: 9 },
  "btc.omft.near": { chain: "BITCOIN", symbol: "BTC", decimals: 8 },
  "eth.omft.near": { chain: "ETHEREUM", symbol: "ETH", decimals: 18 },
  "usdc.omft.near": { chain: "NEAR", symbol: "USDC", decimals: 6 },
  "wrap.near": { chain: "NEAR", symbol: "NEAR", decimals: 24 },
};

/**
 * Normalizes raw blockchain token identifier into canonical chain metadata.
 */
export function normalizeAssetId(
  rawAssetId: string,
  assetRegistry: Readonly<Record<string, KnownChainAsset>> = DEFAULT_ASSET_REGISTRY
): KnownChainAsset {
  const cleanId = rawAssetId.replace(/^nep141:/, "").toLowerCase();

  if (assetRegistry[cleanId]) {
    return assetRegistry[cleanId]!;
  }

  // Preserve the identifier; guessing a symbol or chain can mislabel an asset.
  return {
    chain: "UNKNOWN",
    symbol: cleanId || "UNKNOWN",
  };
}

/**
 * Formats a raw integer string with decimal points.
 */
export function formatAmountWithDecimals(rawAmount: string, decimals?: number): string {
  if (decimals === undefined) return rawAmount;
  try {
    const raw = BigInt(rawAmount);
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const remainder = raw % divisor;

    if (remainder === 0n) {
      return whole.toString();
    }

    const remainderStr = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole}.${remainderStr}`;
  } catch {
    return rawAmount;
  }
}

/**
 * Parses NEP-297 event logs emitted by clearinghouses like intents.near.
 */
export function parseDIP4EventsFromLogs(
  logs: string[],
  assetRegistry: Readonly<Record<string, KnownChainAsset>> = DEFAULT_ASSET_REGISTRY
): NormalizedOmnichainIntent[] {
  const results: NormalizedOmnichainIntent[] = [];

  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;

    try {
      const jsonStr = log.substring("EVENT_JSON:".length).trim();
      const eventObj = JSON.parse(jsonStr) as {
        standard?: string;
        event?: string;
        data?: Array<Record<string, unknown>>;
      };

      if (eventObj.standard === "dip4" || eventObj.standard === "intents.near" || eventObj.event === "intent_execution") {
        const rawData = eventObj.data;
        const dataEntries: Array<Record<string, unknown>> = Array.isArray(rawData)
          ? rawData
          : (rawData ? [rawData as Record<string, unknown>] : []);

        for (const entry of dataEntries) {
          if (!entry) continue;

          const intentId = entry["intent_id"]
            ? String(entry["intent_id"])
            : `derived_${createHash("sha256").update(JSON.stringify(entry)).digest("hex")}`;
          const rawTokenIn = String(entry["token_in"] ?? entry["asset_in"] ?? "");
          const rawTokenOut = String(entry["token_out"] ?? entry["asset_out"] ?? "");
          const rawAmountIn = String(entry["amount_in"] ?? "0");
          const rawAmountOut = String(entry["amount_out"] ?? "0");

          const assetIn = normalizeAssetId(rawTokenIn, assetRegistry);
          const assetOut = normalizeAssetId(rawTokenOut, assetRegistry);

          const sourceChain = String(entry["source_chain"] ?? assetIn.chain);
          const destChain = String(entry["destination_chain"] ?? assetOut.chain);

          results.push({
            intent_id: intentId,
            source_chain: sourceChain,
            destination_chain: destChain,
            token_in: assetIn.symbol,
            token_out: assetOut.symbol,
            amount_in_raw: rawAmountIn,
            amount_out_raw: rawAmountOut,
            amount_in_formatted: `${formatAmountWithDecimals(rawAmountIn, assetIn.decimals)} ${assetIn.symbol}`,
            amount_out_formatted: `${formatAmountWithDecimals(rawAmountOut, assetOut.decimals)} ${assetOut.symbol}`,
            relayer: entry["relayer"] ? String(entry["relayer"]) : undefined,
          });
        }
      }
    } catch {
      // Ignore malformed logs
    }
  }

  return results;
}

