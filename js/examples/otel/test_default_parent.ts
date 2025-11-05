// test_default_parent.ts - Test default parent behavior
import { BraintrustSpanProcessor } from "../../src";

console.log("Testing default parent behavior...");

async function testDefaultParent() {
  // Create BraintrustSpanProcessor without specifying parent
  const processor = await BraintrustSpanProcessor.create({
    // No parent specified - should use default
  });

  console.log("Default parent test completed.");
}

testDefaultParent().catch(console.error);
