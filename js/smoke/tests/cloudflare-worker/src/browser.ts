import * as braintrust from "braintrust/browser";
import { createWorker } from "./worker";

export default createWorker(braintrust, "cloudflare-worker-browser");
