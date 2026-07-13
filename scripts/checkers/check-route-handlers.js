'use strict';
const { walk, read, rel } = require('./lib');

/** Every route must point at a handler that exists. */
module.exports = function checkRouteHandlers() {
  const problems = [];
  for (const file of walk('src/routes')) {
    const src = read(file);
    const imports = {};
    const impRe = /const\s+(\w+)\s*=\s*require\('([^']+)'\)/g;
    let m;
    while ((m = impRe.exec(src))) imports[m[1]] = m[2];

    const routeRe = /router\.(get|post|put|patch|delete)\([^)]*?(\w+)\.(\w+)\s*[,)]/g;
    while ((m = routeRe.exec(src))) {
      const [, , obj, handler] = m;
      if (!imports[obj]) continue;
      const target = imports[obj].replace(/^\.\./, 'src').replace(/^\.\//, 'src/routes/');
      const path = require('node:path');
      const resolved = path.resolve('src/routes', imports[obj]) + '.js';
      if (!require('node:fs').existsSync(resolved)) continue;
      const mod = read(resolved);
      if (!new RegExp(`exports\\.${handler}\\b|${handler}\\s*[,:]`).test(mod)) {
        problems.push(`${rel(file)}: route references ${obj}.${handler}, which does not exist in ${imports[obj]}`);
      }
    }
  }
  return problems;
};
