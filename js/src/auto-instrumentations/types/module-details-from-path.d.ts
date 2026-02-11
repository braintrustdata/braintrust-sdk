declare module "module-details-from-path" {
  interface ModuleDetails {
    name: string;
    basedir: string;
    path: string;
  }

  function moduleDetailsFromPath(filePath: string): ModuleDetails | null;

  export = moduleDetailsFromPath;
}
