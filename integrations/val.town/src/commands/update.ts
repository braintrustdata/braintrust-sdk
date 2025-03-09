import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { expandGlob } from "@std/fs";
import { z } from "zod";
import { join } from "@std/path";

const configSchema = z.object({
  val_id: z.string(),
});

async function updateVal(valDir: string) {
  const configPath = join(valDir, "config.json");
  const codePath = join(valDir, "code.ts");
  const readmePath = join(valDir, "README.md");

  try {
    const [configContent, code, readme] = await Promise.all([
      Deno.readTextFile(configPath),
      Deno.readTextFile(codePath),
      Deno.readTextFile(readmePath),
    ]);

    const { val_id: valId } = configSchema.parse(JSON.parse(configContent));

    const apiKey = Deno.env.get("VALTOWN_API_KEY");
    if (!apiKey) {
      throw new Error("VALTOWN_API_KEY environment variable is required");
    }

    await Promise.all([
      updateValCode(valId, code, apiKey),
      updateValReadme(valId, readme, apiKey),
    ]);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.log(
        colors.yellow(
          `Skipping ${valDir} because it's missing required files (config.json, code.ts, or README.md)`,
        ),
      );
    } else {
      console.log(
        colors.red(
          `Error processing ${valDir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }
}

export const command = new Command()
  .name("update")
  .description("Update vals from the vals directory")
  .action(async () => {
    for await (const dir of expandGlob("vals/*")) {
      if (dir.isDirectory) {
        await updateVal(dir.path);
      }
    }
  });

const updateValCode = async (valId: string, code: string, apiKey: string) => {
  const response = await fetch(
    `https://api.val.town/v1/vals/${valId}/versions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    console.log(colors.red(`✗ Failed to update ${valId} code: ${error}`));
  } else {
    console.log(colors.green(`✓ Successfully updated ${valId} code`));
  }
};

const updateValReadme = async (
  valId: string,
  readme: string,
  apiKey: string,
) => {
  const response = await fetch(`https://api.val.town/v1/vals/${valId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ readme }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.log(colors.red(`✗ Failed to update ${valId} readme: ${error}`));
  } else {
    console.log(colors.green(`✓ Successfully updated ${valId} readme`));
  }
};
