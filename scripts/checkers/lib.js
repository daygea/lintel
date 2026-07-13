'use strict';
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, ext = '.js') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(process.cwd(), f);

module.exports = { walk, read, rel };
