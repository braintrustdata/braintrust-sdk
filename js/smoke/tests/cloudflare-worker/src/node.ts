import * as braintrust from "braintrust";
import { createWorker } from "./worker";

export default createWorker(braintrust, "cloudflare-worker-node");
