// This import triggers the webpack-loader to instrument the openai module.
// No actual API call is made — we only verify the build output is instrumented.
// Completions is referenced in the response to prevent tree-shaking.
import { Completions } from "openai/resources/chat/completions";

export async function GET() {
  return Response.json({ ok: true, ref: typeof Completions });
}
