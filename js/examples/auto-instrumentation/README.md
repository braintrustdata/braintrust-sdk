# Auto-Instrumentation Examples

This directory demonstrates how to use Braintrust's auto-instrumentation feature with various AI SDKs. Auto-instrumentation automatically traces your AI SDK calls without needing to manually wrap clients.

## Prerequisites

### 1. Install Dependencies

```bash
npm install
```

This will install all required dependencies including `@braintrust/auto-instrumentations` and the various AI SDKs.

### 2. Set Up Environment Variables

**Important:** Before running any examples, you must create a `.env` file with your API keys:

```bash
cp .env.example .env
```

Then edit `.env` and add your API keys:

```bash
BRAINTRUST_API_KEY=your_braintrust_key_here
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
GOOGLE_GENAI_API_KEY=your_google_key_here
```

Get your API keys from:

- **Braintrust**: https://www.braintrust.dev
- **OpenAI**: https://platform.openai.com
- **Anthropic**: https://console.anthropic.com
- **Google GenAI**: https://aistudio.google.com/apikey

## Supported SDKs

The examples demonstrate auto-instrumentation with:

- **OpenAI SDK** - Chat completions, embeddings, streaming
- **Anthropic SDK** - Messages API, streaming
- **Vercel AI SDK** - Generate text and objects
- **Google GenAI SDK** - Gemini models
- **Claude Agent SDK** - Agent queries with tools (uses Anthropic API)

## Running Examples

Each example can be run using the provided npm scripts, which automatically use the `--import` flag to enable auto-instrumentation:

```bash
npm run openai          # OpenAI chat completion
npm run openai-streaming # OpenAI streaming
npm run anthropic       # Anthropic messages
npm run vercel          # Vercel AI SDK
npm run google          # Google GenAI
npm run claude-agent    # Claude Agent SDK
```

Or run them directly:

```bash
node --import @braintrust/auto-instrumentations/hook.mjs openai-example.js
```

## How It Works

1. **No manual wrapping needed** - Unlike the traditional approach where you call `wrapOpenAI()` or `wrapAnthropic()`, auto-instrumentation handles this automatically
2. **Just call `initLogger()`** - Initialize Braintrust logging at the start of your application
3. **Use SDKs normally** - Create and use AI SDK clients as you normally would
4. **Automatic tracing** - All API calls are automatically traced to Braintrust

## Configuration

### Disable Specific Integrations

You can disable auto-instrumentation for specific SDKs:

**Via Environment Variable:**

```bash
BRAINTRUST_DISABLE_INSTRUMENTATION=openai npm run anthropic
```

**Programmatically:**

```typescript
import { configureInstrumentation } from "braintrust";

configureInstrumentation({
  integrations: {
    openai: false,
  },
});
```

## Comparing with Manual Wrapping

**Traditional approach (manual wrapping):**

```typescript
import { wrapOpenAI, initLogger } from "braintrust";
import OpenAI from "openai";

initLogger({ projectName: "my-project" });
const client = wrapOpenAI(new OpenAI()); // Manual wrapping required
```

**Auto-instrumentation approach:**

```typescript
import { initLogger } from "braintrust";
import OpenAI from "openai";

initLogger({ projectName: "my-project" });
const client = new OpenAI(); // No wrapping needed!
```

## More Information

See the main documentation at:

- [Auto-Instrumentation Package](../../integrations/auto-instrumentations/README.md)
- [Braintrust Docs](https://www.braintrust.dev/docs)
