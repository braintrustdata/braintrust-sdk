# Braintrust AI SDK Tool Calls Example

This example demonstrates the fix for GitHub issue #777, where tool calls were incorrectly serialized as JSON strings in the content field instead of using the proper OpenAI-compatible `tool_calls` array format.

## What this example shows

- **Before the fix**: Tool calls were `JSON.stringify()`ed into the `content` field
- **After the fix**: Tool calls are properly formatted in a `tool_calls` array with empty `content`

## Prerequisites

1. Set your OpenAI API key:

   ```bash
   export OPENAI_API_KEY="your-api-key-here"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running the example

```bash
npm start
```

This will:

1. Create a weather tool that returns mock weather data
2. Ask the AI about weather in San Francisco
3. Show how tool calls are now properly formatted
4. Display the correct OpenAI message format

## Expected output

You should see:

- The AI making a tool call to get weather
- Tool calls properly formatted in OpenAI format
- Confirmation that the fix is working correctly

## The fix

The key change was in `postProcessOutput()` function in `src/wrappers/ai-sdk.ts`:

**Before:**

```javascript
content: JSON.stringify(toolCalls); // ❌ Wrong
```

**After:**

```javascript
content: "",
tool_calls: toolCalls.map(call => ({
  id: call.toolCallId,
  type: "function",
  function: {
    name: call.toolName,
    arguments: call.args
  }
}))  // ✅ Correct OpenAI format
```

This ensures compatibility with OpenAI message format and proper rendering in Braintrust's LLM view.
