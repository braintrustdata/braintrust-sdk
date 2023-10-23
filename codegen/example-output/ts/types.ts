export interface RegisteredProject {
  id: string;
  name: string;
}
export interface DatasetConstructorArgs {
  project: RegisteredProject;
  id: string;
  name: string;
  pinnedVersion?: string | undefined;
}
export interface DatasetInsertArgs {
  input: unknown;
  output: unknown;
  metadata?: Record<string, unknown> | undefined;
  id?: string | undefined;
}
