const { getPromptAuditLog, login } = require("../dist/index.js");

async function testGetPromptAuditLog() {
  try {
    // Initialize Braintrust (you need to be logged in)
    console.log("Initializing Braintrust...");
    await login();

    // Example usage with your actual IDs
    const projectId = "37a8a4f4-4a34-4cdc-9b87-91ec0ebe9a97";
    const functionId = "946a7f83-4f63-45e6-9148-7cf65f396b29";

    console.log("Testing getPromptAuditLog...");
    console.log(`Project ID: ${projectId}`);
    console.log(`Function ID: ${functionId}`);

    const auditLog = await getPromptAuditLog(projectId, functionId);

    console.log("Audit log result:");
    console.log(JSON.stringify(auditLog, null, 2));
  } catch (error) {
    console.error("Error testing getPromptAuditLog:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Run the test
testGetPromptAuditLog();
