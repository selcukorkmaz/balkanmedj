/**
 * Backup utility — creates timestamped copies of data files before writes.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { PATHS } = require('./data-io');

const BACKUPS_DIR = path.resolve(__dirname, '..', 'backups');
const MAX_BACKUPS = 10;

// Human-readable description of every file a backup contains. Used to generate
// the README.txt embedded in each downloaded backup ZIP so the contents and
// scope of the archive are explicit.
const FILE_INFO = {
  'articles.js':           { label: 'Makaleler',            desc: 'Tüm yayımlanmış makale kayıtları (başlık, yazarlar, DOI, özet, cilt/sayı, sayfa vb.)' },
  'articles-in-press.js':  { label: 'Baskıda Makaleler',    desc: 'Henüz bir sayıya atanmamış, kabul edilmiş makaleler' },
  'archive-issues.js':     { label: 'Arşiv / Sayılar',      desc: 'Tüm cilt ve sayı tanımları' },
  'editorial-board.js':    { label: 'Yayın Kurulu',         desc: 'Editör ve kurul üyeleri listesi' },
  'editorial-extended.js': { label: 'Yayın Kurulu (Detay)', desc: 'Kurul üyelerinin genişletilmiş bilgileri' },
  'news.js':               { label: 'Haberler',             desc: 'Site haberleri ve duyuruları' },
  'homepage-articles.js':  { label: 'Anasayfa Makaleleri',  desc: 'Anasayfada öne çıkan makale seçkisi' },
  'author-metadata.js':    { label: 'Yazar Metadata',       desc: 'Yazar bilgileri ve ORCID verileri' },
};

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

// Build the README.txt that ships inside every downloaded backup ZIP, so the
// archive's contents and scope are unambiguous.
function buildReadme(name, files) {
  const [datePart, timePart = ''] = String(name).split('T');
  const time = timePart.replace(/-/g, ':');
  const L = [];
  L.push('BALKAN MEDICAL JOURNAL — VERİ YEDEĞİ');
  L.push('======================================');
  L.push('');
  L.push(`Yedek tarihi : ${`${datePart} ${time}`.trim()}`);
  L.push(`Dosya sayısı : ${files.length} veri dosyası`);
  L.push('');
  L.push('İÇERİK');
  L.push('------');
  L.push('Bu arşiv, yönetim panelindeki tüm yapısal verilerin bu ana ait bir');
  L.push('anlık kopyasıdır. Her dosya, sitenin js/data/ klasöründeki bir veri');
  L.push('dosyasına birebir karşılık gelir:');
  L.push('');
  for (const f of files) {
    const info = FILE_INFO[f];
    L.push(`  - ${f}`);
    if (info) L.push(`      ${info.label}: ${info.desc}`);
  }
  L.push('');
  L.push('KAPSAM DIŞI (bu yedekte YER ALMAZ)');
  L.push('----------------------------------');
  L.push('  - PDF dosyaları (js/data/pdfs/)');
  L.push('  - Makale görselleri ve figürler (images/)');
  L.push('  - Ek materyaller (js/data/supplementary/)');
  L.push('  - Makale tam metin HTML dosyaları (js/data/articles/*.html)');
  L.push('  - HTML sayfaları ve site şablonları');
  L.push('Yedek yalnızca yapısal veri (.js) dosyalarını içerir; büyük ikili');
  L.push('dosyalar (PDF, görsel) kapsam dışıdır.');
  L.push('');
  L.push('GERİ YÜKLEME');
  L.push('------------');
  L.push('Bir dosyayı geri yüklemek için ZIP içindeki ilgili .js dosyasını,');
  L.push('sitenin js/data/ klasöründeki aynı adlı dosyanın üzerine kopyalayın.');
  L.push('');
  return L.join('\r\n');
}

// Package a stored backup folder into a ZIP buffer, with a README.txt manifest.
function zipBackup(name) {
  const safe = path.basename(String(name || ''));
  const dir = path.join(BACKUPS_DIR, safe);
  if (!safe || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('Yedek bulunamadı');
  }
  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  const zip = new AdmZip();
  for (const f of files) zip.addLocalFile(path.join(dir, f));
  zip.addFile('README.txt', Buffer.from(buildReadme(safe, files), 'utf8'));
  return { buffer: zip.toBuffer(), filename: `bmj-backup-${safe}.zip` };
}

module.exports = { createBackup, listBackups, zipBackup, FILE_INFO };
