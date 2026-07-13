'use strict';
const { walk, read, rel } = require('./lib');

/**
 * One service layer, two transports. A capability reachable from the EJS admin but
 * not from the JSON API (or vice versa) is how mobile and web drift apart. Annotate
 * a deliberate exception with @parity-exempt and say why.
 */
function servicesUsedIn(dir) {
  const used = new Map();
  for (const file of walk(dir)) {
    const src = read(file);
    if (src.includes('@parity-exempt')) continue;
    const re = /(\w+)\.(\w+)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      if (/service/i.test(m[1])) {
        if (!used.has(m[1])) used.set(m[1], new Set());
        used.get(m[1]).add(m[2]);
      }
    }
  }
  return used;
}

module.exports = function checkApiParity() {
  const problems = [];
  const web = servicesUsedIn('src/controllers/web');
  const api = servicesUsedIn('src/controllers/api');

  for (const [svc, methods] of web) {
    for (const method of methods) {
      if (!api.get(svc)?.has(method)) {
        problems.push(
          `${svc}.${method}() is reachable from the web controllers but not the API. Add it, or annotate the controller with @parity-exempt and say why.`
        );
      }
    }
  }
  return problems;
};
