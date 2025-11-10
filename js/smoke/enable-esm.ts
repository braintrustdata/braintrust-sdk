import fs from "fs";
const path = "package.json";

const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
pkg.type = "module";
fs.writeFileSync(path, JSON.stringify(pkg, null, 2));

console.log("package.json updated to ESM build");
