// Copies browser libraries from node_modules into www/lib (the app has no bundler).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const libDir = path.join(root, 'www', 'lib');
fs.mkdirSync(libDir, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'jszip', 'dist', 'jszip.min.js'), path.join(libDir, 'jszip.min.js'));
console.log('Copied jszip.min.js to www/lib');

const fontDir = path.join(root, 'www', 'fonts');
fs.mkdirSync(fontDir, { recursive: true });
fs.copyFileSync(
  path.join(root, 'node_modules', '@fontsource-variable', 'plus-jakarta-sans', 'files', 'plus-jakarta-sans-latin-wght-normal.woff2'),
  path.join(fontDir, 'plus-jakarta-sans.woff2'),
);
console.log('Copied Plus Jakarta Sans to www/fonts');
