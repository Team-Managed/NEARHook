#!/usr/bin/env node

import { Command } from "commander";
import { createListenCommand } from "../commands/listen.js";

const program = new Command("nearhook");

program
  .name("nearhook")
  .description("NearHook CLI: Receipt-Aware Webhook Gateway & Local Tunneling for NEAR")
  .version("0.1.0")
  .addCommand(createListenCommand());

program.parse(process.argv);
