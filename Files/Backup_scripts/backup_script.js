const fs = require('fs');
const path = require('path');

const source = 'C:\\Users\\rahul.k\\Desktop\\data-analytics-lab-rapidInsghtStudio';
const destination = 'C:\\Users\\rahul.k\\Desktop\\Rapidinsghtstudio';

const excludeDirs = ['.git', 'node_modules', '.next', 'dist', '.gemini', '.agents', 'build', '.env'];
const includeExts = ['.js', '.mjs', '.cjs', '.json', '.jsx', '.css', '.html', '.md', '.yml', '.yaml', '.csv'];

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) return;
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

function copyFolderRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);

  if (stats.isDirectory()) {
    const base = path.basename(src);
    if (excludeDirs.includes(base)) return;

    const files = fs.readdirSync(src);
    for (const file of files) {
      copyFolderRecursive(path.join(src, file), path.join(dest, file));
    }
  } else if (stats.isFile()) {
    const ext = path.extname(src);
    const name = path.basename(src);
    const isEnv = name.startsWith('.env');

    if (includeExts.includes(ext) || isEnv) {
      ensureDirectoryExistence(dest);
      fs.copyFileSync(src, dest);
    }
  }
}

console.log('Starting backup...');
copyFolderRecursive(source, destination);
console.log('Backup complete to ' + destination);
