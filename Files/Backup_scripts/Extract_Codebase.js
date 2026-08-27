const fs = require('fs');
const path = require('path');

// === EDIT THIS PATH ===
const PROJECT_DIR = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.join(__dirname, 'Combine_codebase');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'combined_codebase.txt');

const INCLUDE_EXTS = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.kt', '.go', '.rb', '.php', '.cs',
  '.cpp', '.c', '.h', '.hpp', '.rs', '.swift', '.m', '.mm', '.sh',
  '.sql', '.html', '.css', '.xml', '.yaml', '.yml', '.json', '.ipynb'
]);

const EXCLUDED_DIR_NAMES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', '.venv',
  'venv', '.mypy_cache', '__pycache__', '.idea', '.vscode', '.env', 'Combine_codebase'
]);

const MAX_FILE_MB = 2; // skip files larger than this
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

function shouldSkipDir(dirName) {
  return EXCLUDED_DIR_NAMES.has(dirName);
}

function iterFiles(dir, fileList = []) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (err) {
    return fileList;
  }

  for (const file of files) {
    const filePath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      continue;
    }

    if (stat.isDirectory()) {
      if (!shouldSkipDir(file)) {
        iterFiles(filePath, fileList);
      }
    } else {
      const ext = path.extname(file).toLowerCase();
      if (INCLUDE_EXTS.has(ext)) {
        if (stat.size <= MAX_FILE_BYTES) {
          fileList.push(filePath);
        }
      }
    }
  }

  return fileList;
}

function getDirectoryTree(dir, prefix = '') {
  let treeStr = '';
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (err) {
    return treeStr;
  }

  const validFiles = [];
  for (const file of files) {
    if (shouldSkipDir(file)) continue;
    
    const filePath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      continue;
    }
    
    if (!stat.isDirectory()) {
      const ext = path.extname(file).toLowerCase();
      if (!INCLUDE_EXTS.has(ext)) continue;
      if (stat.size > MAX_FILE_BYTES) continue;
    }
    
    validFiles.push({ name: file, isDirectory: stat.isDirectory(), path: filePath });
  }
  
  validFiles.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  validFiles.forEach((fileObj, index) => {
    const isLast = index === validFiles.length - 1;
    const pointer = isLast ? '└── ' : '├── ';
    treeStr += `${prefix}${pointer}${fileObj.name}\n`;
    
    if (fileObj.isDirectory) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      treeStr += getDirectoryTree(fileObj.path, newPrefix);
    }
  });

  return treeStr;
}

console.log('Starting extraction...');
const outStream = fs.createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
const allFiles = iterFiles(PROJECT_DIR);

// Write directory structure at the top
outStream.write('='.repeat(60) + '\n');
outStream.write('DIRECTORY STRUCTURE\n');
outStream.write('='.repeat(60) + '\n');
outStream.write(path.basename(PROJECT_DIR) + '\n');
outStream.write(getDirectoryTree(PROJECT_DIR) + '\n');

for (const filePath of allFiles) {
  outStream.write('\n\n' + '='.repeat(60) + '\n');
  outStream.write(`FILE: ${filePath}\n`);
  outStream.write('='.repeat(60) + '\n');

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    outStream.write(content);
  } catch (e) {
    outStream.write(`\n[Skipped due to read error: ${e.message}]\n`);
  }
}

outStream.end();

outStream.on('finish', () => {
  console.log(`Successfully combined ${allFiles.length} files into:`);
  console.log(OUTPUT_FILE);
});
