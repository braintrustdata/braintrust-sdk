import * as http from "http";
import * as https from "https";
import axios from "axios";

import iso from "./isomorph";
import { getRepoStatus, getPastNAncestors } from "./gitutil";

export function configureNode() {
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
}
