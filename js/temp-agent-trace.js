/**
 * Temporary script to test OpenAI agents with Braintrust tracing
 * 
 * Run with: node temp-agent-trace.js
 * 
 * Requirements:
 * - OPENAI_API_KEY environment variable
 * - BRAINTRUST_API_KEY environment variable (optional, can login via browser)
 */

async function main() {
  try {
    // Import the built modules
    const braintrust = await import('./dist/index.js');

    const { Agent, run, tool, addTraceProcessor, setTracingDisabled } = await import('@openai/agents');
    const { z } = await import('zod');

    console.log('Setting up Braintrust logger...');
    
    // Initialize Braintrust logging
    const logger = braintrust.initLogger({
      projectId: "37a8a4f4-4a34-4cdc-9b87-91ec0ebe9a97",
    });

    // Enhanced processor that logs raw data AND sends to Braintrust
    class EnhancedTracingProcessor extends braintrust.BraintrustTracingProcessor {
      onTraceStart(trace) {
        // console.log('\n=== RAW TRACE START ===');
        // console.log(JSON.stringify(trace, null, 2));
        return super.onTraceStart(trace);
      }
      
      onTraceEnd(trace) {
        // console.log('\n=== RAW TRACE END ===');
        // console.log(JSON.stringify(trace, null, 2));
        return super.onTraceEnd(trace);
      }
      
      onSpanStart(span) {
        // console.log('\n=== RAW SPAN START ===');
        // console.log(JSON.stringify(span, null, 2));
        return super.onSpanStart(span);
      }
      
      onSpanEnd(span) {
        // console.log('\n=== RAW SPAN END ===');
        // console.log(JSON.stringify(span, null, 2));
        return super.onSpanEnd(span);
      }
    }

    // Set up enhanced tracing (logs raw data + sends to Braintrust)
    const processor = new EnhancedTracingProcessor(logger);
    setTracingDisabled(false);
    addTraceProcessor(processor);

    console.log('Creating tools...');

    // Create a weather tool using the proper tool() helper
    const getWeatherTool = tool({
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: z.object({ city: z.string() }),
      execute: async (input) => {
        console.log(`🌤️  Getting weather for ${input.city}...`);
        return `The weather in ${input.city} is sunny with temperature 72°F and light winds.`;
      },
    });

    // Create a calculator tool for more complex interactions
    const calculatorTool = tool({
      name: "calculator",
      description: "Perform basic math calculations",
      parameters: z.object({ 
        operation: z.string().describe("The math operation to perform, e.g., '2 + 2' or '10 * 5'")
      }),
      execute: async (input) => {
        console.log(`🧮 Calculating: ${input.operation}`);
        try {
          // Simple eval for basic math (don't do this in production!)
          const result = eval(input.operation.replace(/[^0-9+\-*/().\s]/g, ''));
          return `The result of ${input.operation} is ${result}`;
        } catch (error) {
          return `Sorry, I couldn't calculate that. Please use basic math operations like +, -, *, /`;
        }
      },
    });

    console.log('Creating agent with tools...');

    // Create agent with tools
    const agent = new Agent({
      name: "weather-calc-agent",
      model: "gpt-4o-mini",
      instructions: `You are a helpful assistant that can get weather information and do calculations. 
        Use the get_weather tool when asked about weather in any city.
        Use the calculator tool when asked to do math.
        Be friendly and helpful!`,
      tools: [getWeatherTool, calculatorTool],
    });

    console.log('Running agent with tool calls...');

    // Run the agent with a prompt that will trigger tool usage
    const result = await run(agent, "What's the weather in San Francisco? Also, what's 15 * 24?");
    console.log(result.finalOutput);
    
    // Clean up
    await processor.shutdown();
    await logger.flush();
    
  } catch (error) {
    console.error('❌ Error:', error.message);  
    
    if (error.message.includes('@openai/agents')) {
      console.log('\n💡 Install @openai/agents first:');
      console.log('   npm install @openai/agents zod');
    }
    
    if (error.message.includes('OPENAI_API_KEY')) {
      console.log('\n💡 Set your OpenAI API key:');
      console.log('   export OPENAI_API_KEY=your_key_here');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}