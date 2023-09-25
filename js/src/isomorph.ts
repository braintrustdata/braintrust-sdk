import axios, { AxiosInstance, CreateAxiosDefaults } from "axios";

export interface RepoStatus {
  commit?: string;
  branch?: string;
  tag?: string;
  dirty: boolean;
  author_name?: string;
  author_email?: string;
  commit_message?: string;
  commit_time?: string;
}

export interface Common {
  makeAxios: (conf: CreateAxiosDefaults) => AxiosInstance;
  getRepoStatus: () => Promise<RepoStatus | undefined>;
  getPastNAncestors: () => Promise<string[]>;
  getEnv: (name: string) => string | undefined;
}

const iso: Common = {
  makeAxios: (conf) =>
    axios.create({
      ...conf,
    }),
  getRepoStatus: async () => undefined,
  getPastNAncestors: async () => [],
  getEnv: (_name) => undefined,
};
export default iso;
