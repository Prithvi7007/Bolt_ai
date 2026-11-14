// Keep navigation decisions independent from Electron for offline unit tests.
const { pathToFileURL } = require('node:url');

function isAllowedNavigation(navigationUrl, devMode, devUrl, builtIndexPath) {
  if (typeof navigationUrl !== 'string' || !navigationUrl) return false;
  // Electron's file navigation URLs use file:// with percent-encoded paths on Windows.
  return navigationUrl === (devMode ? devUrl : pathToFileURL(builtIndexPath).href);
}
module.exports = { isAllowedNavigation };
