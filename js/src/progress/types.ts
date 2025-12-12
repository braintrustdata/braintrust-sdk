export interface ProgressReporter {
  start: (name: string, total: number) => void;
  stop: () => void;
  increment: (name: string) => void;
  setTotal?: (name: string, total: number) => void;
}
