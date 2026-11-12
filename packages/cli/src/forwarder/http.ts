import {
  type CanonicalWebhookPayload,
  type AgentSafePayload,
} from "@nearhook/core";

export interface ForwardOptions {
  attempt?: number | undefined;
  timeoutMs?: number | undefined;
  signature?: string | undefined;
}

export interface ForwardResult {
  success: boolean;
  status: number;
  latencyMs: number;
  error?: string;
}

export async function forwardPayload(
  url: string,
  payload: CanonicalWebhookPayload | AgentSafePayload,
  options: ForwardOptions = {}
): Promise<ForwardResult> {
  const attempt = options.attempt ?? 1;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startTime = performance.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-NearHook-Id": payload.id,
      "X-NearHook-Timestamp": payload.timestamp.toString(),
      "X-NearHook-Delivery-Attempt": attempt.toString(),
    };

    if (options.signature) {
      headers["X-NearHook-Signature"] = options.signature;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - startTime);
    return {
      success: response.ok,
      status: response.status,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const cause = err instanceof Error && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
    const causeStr = cause ? ` (${cause instanceof Error ? cause.message : String(cause)})` : "";
    const message = (err instanceof Error ? err.message : String(err)) + causeStr;
    return {
      success: false,
      status: 0,
      latencyMs,
      error: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
