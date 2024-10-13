// A response header whose presence indicates that an object insert operation
// (POST or PUT) encountered an existing version of the object.
export const BT_FOUND_EXISTING_HEADER = "x-bt-found-existing";

// The pagination cursor header.
export const BT_CURSOR_HEADER = "x-bt-cursor";

// User impersonation header.
export const BT_IMPERSONATE_USER = "x-bt-impersonate-user";

// Project ID header for OTEL exporters to specify a destination Braintrust project.
export const BT_PROJECT_ID = "x-bt-project-id";
