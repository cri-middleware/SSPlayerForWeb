import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function measureSize(filePath) {
  if (!fs.existsSync(filePath)) return '-';
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath);
  const gzContent = zlib.gzipSync(content);
  return `${(gzContent.length / 1024).toFixed(2)} KB (gz)`;
}

const target = path.resolve('dist/index.js');
console.log(`Size of ssplayer-webgl index.js: ${measureSize(target)}`);
