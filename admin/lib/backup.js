/**
 * Backup utility — creates timestamped copies of data files before writes.
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('./data-io');

const BACKUPS_DIR = path.resolve(__dirname, '..', 'backups');
const MAX_BACKUPS = 10;

function createBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(BACKUPS_DIR, stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const filesToBackup = [
    PATHS.articles,
    PATHS.articlesInPress,
    PATHS.archiveIssues,
    PATHS.editorialBoard,
    PATHS.editorialExtended,
    PATHS.news,
    PATHS.homepageArticles,
    PATHS.authorMetadata,
  ];

  let count = 0;
  for (const src of filesToBackup) {
    if (fs.existsSync(src)) {
      const dest = path.join(backupDir, path.basename(src));
      fs.copyFileSync(src, dest);
      count++;
    }
  }

  pruneOldBackups();
  return { dir: backupDir, fileCount: count, timestamp: stamp };
}

function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const dirs = fs
    .readdirSync(BACKUPS_DIR)
    .filter((d) => fs.statSync(path.join(BACKUPS_DIR, d)).isDirectory())
    .sort()
    .reverse();

  for (let i = MAX_BACKUPS; i < dirs.length; i++) {
    const dirPath = path.join(BACKUPS_DIR, dirs[i]);
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((d) => fs.statSync(path.join(BACKUPS_DIR, d)).isDirectory())
    .sort()
    .reverse()
    .map((d) => {
      const files = fs.readdirSync(path.join(BACKUPS_DIR, d));
      return { name: d, fileCount: files.length, files };
    });
}

module.exports = { createBackup, listBackups };
