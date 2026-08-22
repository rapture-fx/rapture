'use strict';

const pico = require('./lib/glob-match');
const utils = require('./lib/utils');

function globMatch(glob, options, returnState = false) {
  // default to os.platform()
  if (options && (options.windows === null || options.windows === undefined)) {
    // don't mutate the original options object
    options = { ...options, windows: utils.isWindows() };
  }

  return pico(glob, options, returnState);
}

Object.assign(globMatch, pico);
module.exports = globMatch;
