// Assembles the page: artifact.html (the fragment the artifact host wraps) and
// index.html (a complete document for static hosting). Both load solver.js,
// data.js and paper.js from beside them.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const head = fs.readFileSync(path.join(__dirname, 'head.part'), 'utf8').replace('</style>', fs.readFileSync(path.join(__dirname, 'extra.css'), 'utf8') + '</style>');
const body = fs.readFileSync(path.join(__dirname, 'body.html'), 'utf8');
const fragment = head + '\n' + body;
fs.writeFileSync(path.join(dir, 'artifact.html'), fragment);
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>\n<html lang="en-GB">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n' + fragment + '\n</html>\n');
fs.copyFileSync(path.join(__dirname, 'solver.js'), path.join(dir, 'solver.js'));
console.log('assembled', fs.statSync(path.join(dir, 'index.html')).size);
