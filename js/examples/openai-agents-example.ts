/**
 * OpenAI Agents SDK integration example with Braintrust tracing
 * 
 * This demonstrates how to use the BraintrustTracingProcessor to automatically
 * trace agent executions from the OpenAI Agents SDK into Braintrust.
 */

import { Agent, run, setTraceProcessors } from '@openai/agents';
import { initLogger, BraintrustTracingProcessor } from 'braintrust';

async function main() {
  // Initialize Braintrust logging
  const logger = initLogger({
    projectName: 'openai-agents-example',
    // apiKey: process.env.BRAINTRUST_API_KEY, // Optional if set in env
  });

  // Set up the Braintrust tracing processor
  setTraceProcessors([new BraintrustTracingProcessor(logger)]);

  // Create a simple agent
  const agent = new Agent({
    name: 'Haiku Assistant',
    instructions: 'You are a helpful assistant that responds only in haikus.',
  });

  console.log('Running agent with Braintrust tracing...');

  try {
    // Run the agent - this will be automatically traced in Braintrust
    const result = await run(agent, 'Tell me about recursion in programming.');
    
    console.log('Result:', result.finalOutput);
    console.log('Check your Braintrust project for the trace!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Ensure all logs are flushed
    logger.flush();
  }
}

// Usage with more complex agent features:
async function advancedExample() {
  const logger = initLogger({ projectName: 'advanced-agents-example' });
  setTraceProcessors([new BraintrustTracingProcessor(logger)]);

  // Agent with tools (if you have tools defined)
  const agent = new Agent({
    name: 'Research Assistant',
    instructions: 'You are a research assistant that helps with information gathering.',
    // tools: [searchTool, calculatorTool], // Add your tools here
  });

  // Multiple runs will all be traced
  const queries = [
    'What is machine learning?',
    'Explain neural networks briefly.',
    'What are the benefits of AI?'
  ];

  for (const query of queries) {
    console.log(`\nQuery: ${query}`);
    const result = await run(agent, query);
    console.log(`Response: ${result.finalOutput}`);
  }

  logger.flush();
}

if (require.main === module) {
  main().catch(console.error);
}