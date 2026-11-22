const fs = require("fs");
const s = fs.readFileSync(process.env.TEMP + "/parser-admin.js", "utf8");
const needle = "/api/v1/tasks";
let from = 0;
let n = 0;
while (n < 8) {
  const i = s.indexOf(needle, from);
  if (i < 0) break;
  console.log("\n---", n, "---\n");
  console.log(s.slice(Math.max(0, i - 120), i + 220));
  from = i + needle.length;
  n += 1;
}
