#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net

import { Command } from "@cliffy/command";
import { command as updateCommand } from "./commands/update.ts";
import { colors } from "@cliffy/ansi/colors";

await new Command()
  .name("cli")
  .version("0.0.1")
  .description("File processing CLI")
  .command("update", updateCommand)
  .error((error) => {
    console.error(
      colors.red(error instanceof Error ? error.message : String(error)),
    );
    Deno.exit(1);
  })
  .parse(Deno.args);
