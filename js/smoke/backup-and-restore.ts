import fs from "fs";

const files = [
  { path: "package.json", backupPath: "package.json.bak" },
  { path: "package-lock.json", backupPath: "package-lock.json.bak" },
];

const command = process.argv[2];

if (!command) {
  console.error('Please provide "backup" or "restore" as argument.');
  process.exit(1);
}

if (command === "backup") {
  for (const { path, backupPath } of files) {
    if (fs.existsSync(path)) {
      fs.copyFileSync(path, backupPath);
      console.log(`${path} backed up to ${backupPath}`);
    }
  }
} else if (command === "restore") {
  let restored = 0;
  for (const { path, backupPath } of files) {
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, path);
      console.log(`${path} restored from ${backupPath}`);
      restored++;
    }
  }
  if (restored === 0) {
    console.error("No backup files found.");
    process.exit(1);
  }
} else {
  console.error('Invalid argument. Use "backup" or "restore".');
  process.exit(1);
}
