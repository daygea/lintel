'use strict';
const ejs = require('ejs');
const { walk, read, rel } = require('./lib');

module.exports = function checkEjsSyntax() {
  const problems = [];
  for (const file of walk('src/views', '.ejs')) {
    try {
      ejs.compile(read(file), { filename: file });
    } catch (err) {
      problems.push(`${rel(file)}: ${err.message.split('\n')[0]}`);
    }
  }
  return problems;
};
