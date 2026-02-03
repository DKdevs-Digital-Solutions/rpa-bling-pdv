const fs = require("fs");

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

module.exports = { readJsonSafe, writeJsonSafe };
