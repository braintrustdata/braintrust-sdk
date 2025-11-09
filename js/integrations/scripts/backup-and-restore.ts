import fs from 'fs';
const path = 'package.json';
const backupPath = 'package.json.bak';

const command = process.argv[2];

if (!command) {
  console.error('Please provide "backup" or "restore" as argument.');
  process.exit(1);
}

if (command === 'backup') {
  fs.copyFileSync(path, backupPath);
  console.log('package.json backed up to package.json.bak');
} else if (command === 'restore') {
  if (!fs.existsSync(backupPath)) {
    console.error('Backup file does not exist.');
    process.exit(1);
  }
  fs.renameSync(backupPath, path);
  console.log('package.json restored from package.json.bak');
} else {
  console.error('Invalid argument. Use "backup" or "restore".');
  process.exit(1);
}
