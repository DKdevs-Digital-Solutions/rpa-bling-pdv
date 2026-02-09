const fs = require("fs");
const path = require("path");

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, value) {
  const dir = path.dirname(file);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

module.exports = { readJsonSafe, writeJsonSafe };
