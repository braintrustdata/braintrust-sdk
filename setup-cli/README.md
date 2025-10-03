# @braintrust/setup

Automatically set up Braintrust tracing in your codebase using Claude Code SDK with MCP integration.

## Overview

This CLI tool uses the **Claude Code SDK** with **Braintrust MCP** integration to intelligently analyze your codebase and automatically add Braintrust tracing. Instead of hardcoded transformations, it leverages Claude's understanding of your code patterns and access to live Braintrust documentation.

## Features

- **🤖 AI-Powered Analysis**: Uses Claude to understand your specific codebase
- **🔗 MCP Integration**: Access to live Braintrust documentation and examples
- **📦 Smart Detection**: Automatically detects OpenAI, Anthropic, LangChain, Vercel AI SDK
- **🎯 Minimal Changes**: Preserves your existing code style and patterns
- **🔄 Interactive**: Shows changes before applying them

## Installation

```bash
npm install -g @braintrust/setup
```

Or use directly with npx:

```bash
npx @braintrust/setup
```

## Prerequisites

- **Node.js project** with `package.json`
- **Anthropic API key** for Claude Code SDK
- **Internet connection** for MCP communication with Braintrust

## Usage

Navigate to your project directory and run:

```bash
npx @braintrust/setup
```

The tool will:

1. **Create MCP Config**: Automatically creates `.mcp.json` for Braintrust integration
2. **Analyze Codebase**: Uses Claude to understand your project structure and AI library usage
3. **Show Analysis**: Displays detected AI libraries and configuration
4. **Confirm Setup**: Asks for confirmation before making changes
5. **Apply Changes**: Uses Claude to implement Braintrust tracing with MCP tool access
6. **Run Commands**: Optionally runs package manager commands to install dependencies

## How It Works

### 1. MCP Configuration

The tool creates a `.mcp.json` file:

```json
{
  "mcpServers": {
    "braintrust": {
      "type": "sse",
      "url": "https://api.braintrust.dev/mcp"
    }
  }
}
```

### 2. Claude Analysis

Uses Claude Code SDK to analyze your project:

- Reads `package.json` and entry points
- Detects AI/ML library usage patterns
- Understands project structure and conventions

### 3. MCP-Enhanced Setup

Claude uses Braintrust MCP tools to:

- Search documentation for relevant examples
- Get project information from your Braintrust account
- Apply best practices based on latest documentation

## Example Output

```bash
🧠 Braintrust Auto-Setup

📊 Analysis Results:
────────────────────────────────────────
✅ Found openai
✅ Found anthropic

? Proceed with Braintrust tracing setup? Yes

🎉 Braintrust Tracing Setup Complete!

📝 Changes made:
  - Added braintrust dependency to package.json
  - Wrapped OpenAI client with wrapOpenAI()
  - Wrapped Anthropic client with wrapAnthropic()
  - Added initLogger() to src/index.ts
  - Created .env example with BRAINTRUST_API_KEY

💻 Commands to run:
  npm install braintrust

🚀 Your project is now ready with Braintrust tracing!
```

## What Gets Added

### Library Wrappers

**OpenAI**:

```typescript
import { wrapOpenAI } from "braintrust";
import OpenAI from "openai";

const client = wrapOpenAI(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }),
);
```

**Anthropic**:

```typescript
import { wrapAnthropic } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";

const client = wrapAnthropic(
  new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
);
```

**Vercel AI SDK**:

```typescript
import { wrapAISDKModel } from "braintrust";
import { openai } from "ai";

const model = wrapAISDKModel(openai("gpt-4"));
```

### Logger Initialization

```typescript
import { initLogger } from "braintrust";

initLogger({
  projectName: "your-project-name",
});
```

## Environment Variables

Add to your `.env` file:

```
BRAINTRUST_API_KEY=your-braintrust-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

## Command Line Options

```bash
npx @braintrust/setup [options]

Options:
  -p, --project-path <path>  Project path (default: current directory)
  --dry-run                  Show what would be changed without making changes
  --no-backup               Skip creating backup files
  -h, --help                Display help information
```

## Advanced Usage

### Custom Project Path

```bash
npx @braintrust/setup -p /path/to/your/project
```

### Dry Run Mode

```bash
npx @braintrust/setup --dry-run
```

## Supported Libraries

- ✅ **OpenAI SDK** (`openai`)
- ✅ **Anthropic SDK** (`@anthropic-ai/sdk`)
- ✅ **LangChain** (`langchain`, `@langchain/core`)
- ✅ **Vercel AI SDK** (`ai`)
- 🔄 **Custom LLM integrations** (Claude will analyze and suggest patterns)

## Troubleshooting

### "No package.json found"

Make sure you're running the command in a Node.js project directory.

### "Analysis failed"

- Check your `ANTHROPIC_API_KEY` environment variable
- Ensure you have internet connectivity for MCP communication
- Try running with `--dry-run` to see what's being analyzed

### "Setup failed"

- The tool creates backups before modifying files
- Check the error message for specific issues
- Verify Braintrust MCP server is accessible

## Why This Approach?

- **Always Up-to-Date**: Uses live Braintrust documentation via MCP
- **Context-Aware**: Claude understands your specific code patterns
- **Flexible**: Handles edge cases that rule-based tools miss
- **Minimal Maintenance**: No need to update transformation rules
- **Best Practices**: Leverages latest Braintrust integration patterns

## Contributing

This tool is part of the Braintrust SDK monorepo. See the main repository for contribution guidelines.

## License

MIT
