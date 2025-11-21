// test_default_parent.ts - Test default parent behavior
import { BraintrustSpanProcessor } from "../../src";

console.log("Testing default parent behavior...");

// Create BraintrustSpanProcessor without specifying parent
const processor = new BraintrustSpanProcessor({
  // No parent specified - should use default
});

console.log("Default parent test completed.");
