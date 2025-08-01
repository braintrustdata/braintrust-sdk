import { expect, test } from "vitest";
import { _exportsForTestingOnly } from "./logger";
import { configureNode } from "./node";

configureNode();

test("simulateLoginForTests and simulateLogoutForTests", async () => {
  for (let i = 0; i < 6; i++) {
    // First login
    const state = await _exportsForTestingOnly.simulateLoginForTests();
    // Verify the login state - now we're logged in
    expect(state.loggedIn).toBe(true);
    expect(state.loginToken).toBe("___TEST_API_KEY__THIS_IS_NOT_REAL___");
    expect(state.orgId).toBe("test-org-id");
    expect(state.orgName).toBe("test-org-name");
    expect(state.apiUrl).toBe("https://braintrust.dev/fake-api-url");

    // Now logout
    const logoutState = _exportsForTestingOnly.simulateLogoutForTests();

    // Verify the logout state - everything should be null or false
    expect(logoutState.loggedIn).toBe(false);
    expect(logoutState.loginToken).toBe(null);
    expect(logoutState.orgId).toBe(null);
    expect(logoutState.orgName).toBe(null);
    expect(logoutState.apiUrl).toBe(null);
    expect(logoutState.appUrl).toBe("https://www.braintrust.dev");
  }
});
