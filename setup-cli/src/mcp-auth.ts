import type { MCPAuthResult } from "./types.js";

/**
 * Since this CLI tool is designed to work with Claude Code SDK,
 * we can leverage Claude Code's existing MCP authentication instead
 * of implementing our own OAuth flow.
 *
 * The tool should instruct users to:
 * 1. Set up Braintrust MCP in Claude Code if not already done
 * 2. Authenticate via Claude Code's built-in MCP flow
 * 3. Then this CLI can work alongside Claude Code
 */

export function checkMCPSetup(): boolean {
  // Check if user is running this from within Claude Code context
  // or if they have Claude Code MCP configured
  const hasClaudeCode =
    process.env.CLAUDE_CODE === "true" || process.env.MCP_AVAILABLE === "true";

  return hasClaudeCode;
}

export function getMCPSetupInstructions(): string {
  return `
💡 This tool is designed to work within Claude Code

If you're seeing this message, it means you're running this tool outside of Claude Code.

For the best experience:

1. Start Claude Code in your project directory:
   claude

2. Run this tool from within Claude Code:
   npx @braintrust/setup

Or simply ask Claude directly:
   "Please set up Braintrust tracing for this codebase using the MCP tools"

Note: If you haven't configured Braintrust MCP in Claude Code yet, Claude will guide you through that setup when you try to use the Braintrust tools.
`;
}

export function createMCPInstructions(): MCPAuthResult {
  // Return placeholder - actual auth handled by Claude Code
  return {
    accessToken: "handled-by-claude-code",
    orgName: "handled-by-claude-code",
    apiUrl: "https://api.braintrust.dev",
  };
}
