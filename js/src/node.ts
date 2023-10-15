import * as http from "http";
import * as https from "https";
import axios from "axios";
import { AsyncLocalStorage } from "node:async_hooks";

import iso from "./isomorph";
import { getRepoStatus, getPastNAncestors } from "./gitutil";
import { getCallerLocation } from "./stackutil";

let _nodeConfigured = false;
export function configureNode() {
  if (_nodeConfigured) {
    return;
  }
  iso.makeAxios = (options) => {
    // From https://github.com/axios/axios/issues/1846
    const httpAgent = new http.Agent({ keepAlive: true });
    const httpsAgent = new https.Agent({ keepAlive: true });

    return axios.create({
      httpAgent,
      httpsAgent,
      ...options,
    });
  };
  iso.getRepoStatus = getRepoStatus;
  iso.getPastNAncestors = getPastNAncestors;
  iso.getEnv = (name) => process.env[name];
  iso.getCallerLocation = getCallerLocation;
  iso.newAsyncLocalStorage = <T>() => new AsyncLocalStorage<T>();
  _nodeConfigured = true;
}
