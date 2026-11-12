import { Command } from "commander";
import { TunnelClient } from "../tunnel/client.js";
import { StandaloneListener } from "../tunnel/standalone.js";

export interface ListenCommandOptions {
  account: string;
  forward: string;
  standalone?: boolean | undefined;
  agentSafe?: boolean | undefined;
  hub?: string | undefined;
  secret?: string | undefined;
}

export function createListenCommand(
  actionHandler: (options: ListenCommandOptions) => Promise<unknown> = runListen
): Command {
  const cmd = new Command("listen");

  cmd
    .description("Start a local zero-config webhook tunnel for NEAR Protocol events")
    .requiredOption("-a, --account <pattern>", "NEAR account pattern to listen for (e.g. 'merchant.testnet', '*.near')")
    .requiredOption("-f, --forward <url>", "Local destination URL (e.g. 'http://localhost:3000/api/webhook')")
    .option("--standalone", "Bypass hosted gateway and poll FastNEAR directly with in-process DAG stitching")
    .option("--agent-safe", "Sanitize untrusted memos and drop dust transactions (< $1.00 USD)")
    .option("--hub <url>", "Custom Tunnel Hub WebSocket URL", process.env.NEARHOOK_HUB_URL || "wss://gateway.nearhook.dev/tunnel")
    .option("--secret <token>", "Shared authentication secret for private Tunnel Hubs")
    .action(async (options: ListenCommandOptions) => {
      await actionHandler(options);
    });

  return cmd;
}

export async function runListen(
  options: ListenCommandOptions,
  hooks: {
    onReady?: (controller: { close: () => void }) => void;
    logger?: (msg: string) => void;
  } = {}
): Promise<{ close: () => void }> {
  const log = hooks.logger ?? console.log;

  log("\n┌────────────────────────────────────────────────────────────────────┐");
  log("│                       NEARHOOK LOCAL TUNNEL                        │");
  log("│      Receipt-Aware Event Delivery Gateway & Local Tunneling        │");
  log("└────────────────────────────────────────────────────────────────────┘\n");
  log(`Account Filter:  ${options.account}`);
  log(`Local Forward:   ${options.forward}`);
  log(`Operating Mode:  ${options.standalone ? "Standalone (FastNEAR direct)" : "Hosted Relay (Tunnel Hub)"}`);
  log(`Agent-Safe Mode: ${options.agentSafe ? "ENABLED 🛡️ (Quarantine + Dust Filter)" : "DISABLED (Raw Payloads)"}\n`);

  if (options.standalone) {
    const listener = new StandaloneListener({
      account: options.account,
      forwardUrl: options.forward,
      agentSafe: options.agentSafe,
      logger: log,
    });

    await listener.start();

    const controller = {
      close: () => listener.stop(),
    };

    hooks.onReady?.(controller);

    process.on("SIGINT", () => {
      log("\n[nearhook] Gracefully shutting down standalone listener...");
      listener.stop();
      process.exit(0);
    });

    return controller;
  } else {
    const client = new TunnelClient({
      hubUrl: options.hub || "wss://gateway.nearhook.dev/tunnel",
      account: options.account,
      forwardUrl: options.forward,
      agentSafe: options.agentSafe,
      secret: options.secret,
      logger: log,
    });

    client.connect();

    const controller = {
      close: () => client.close(),
    };

    hooks.onReady?.(controller);

    process.on("SIGINT", () => {
      log("\n[nearhook] Gracefully disconnecting tunnel...");
      client.close();
      process.exit(0);
    });

    return controller;
  }
}
