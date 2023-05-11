const fs = require('fs');
const path = require('path');

const options = { recursive: true };
const DIST = path.resolve('dist', 'win-unpacked');
const DIST_BIN = path.resolve(DIST, 'bin');
const WORKSPACE = path.resolve('workspace');
const DIST_WORKSPACE = path.resolve(DIST, 'workspace');

fs.mkdirSync(DIST_BIN, options);
fs.mkdirSync(DIST_WORKSPACE, options);
fs.cpSync(WORKSPACE, DIST_WORKSPACE, options);
