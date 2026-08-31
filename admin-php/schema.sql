-- Balkan Medical Journal — Admin (PHP) MySQL schema
-- Document-oriented: each data source keeps its original object shape in a JSON
-- `data` column (parity with the schemaless window.X = [...] JS files), with a
-- few hot fields lifted into real columns for indexing/queries/stats.

SET NAMES utf8mb4;
SET sql_mode = 'STRICT_ALL_TABLES';

-- --- Auth -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  username      VARCHAR(64) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  ip           VARCHAR(64) NOT NULL,
  attempted_at INT NOT NULL,
  INDEX idx_ip_ts (ip, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Articles (published) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id           INT PRIMARY KEY,
  seq          INT NOT NULL DEFAULT 0,   -- preserves articles.js array order
  type         VARCHAR(128) NULL,
  volume       INT NULL,
  issue        VARCHAR(32) NULL,
  featured     TINYINT(1) NOT NULL DEFAULT 0,
  image_corner TINYINT(1) NOT NULL DEFAULT 0,
  citations    INT NOT NULL DEFAULT 0,
  downloads    INT NOT NULL DEFAULT 0,
  published    DATE NULL,
  data         JSON NOT NULL,
  INDEX idx_seq (seq),
  INDEX idx_vol_issue (volume, issue),
  INDEX idx_type (type),
  INDEX idx_featured (featured)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Full text HTML body, keyed by article id (ids are unique across published +
-- in-press, see nextArticleId() parity in the migration).
CREATE TABLE IF NOT EXISTS article_fulltext (
  article_id INT PRIMARY KEY,
  html       LONGTEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Articles in press ------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles_in_press (
  id         INT PRIMARY KEY,
  sort_order INT NOT NULL DEFAULT 0,
  data       JSON NOT NULL,
  INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- News -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news (
  id    INT PRIMARY KEY,
  date  DATE NULL,
  data  JSON NOT NULL,
  INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Issue-level uploaded files (issue PDFs, covers) ------------------------
CREATE TABLE IF NOT EXISTS issue_files (
  volume        INT NOT NULL,
  issue         VARCHAR(32) NOT NULL,
  type          VARCHAR(32) NOT NULL,
  url           VARCHAR(512) NULL,
  original_name VARCHAR(512) NULL,
  PRIMARY KEY (volume, issue, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Custom / editable pages ------------------------------------------------
CREATE TABLE IF NOT EXISTS pages (
  slug        VARCHAR(128) PRIMARY KEY,
  title       VARCHAR(512) NULL,
  description TEXT NULL,
  short_code  VARCHAR(64) NULL,
  html        LONGTEXT NULL,
  data        JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Short links ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS short_links (
  code VARCHAR(64) PRIMARY KEY,
  data JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Supplementary material library -----------------------------------------
CREATE TABLE IF NOT EXISTS supp_library (
  name VARCHAR(255) PRIMARY KEY,
  data JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Per-article figure metadata --------------------------------------------
CREATE TABLE IF NOT EXISTS media_figure_meta (
  article_id INT PRIMARY KEY,
  data       JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --- Single-blob datasets (one row each) ------------------------------------
-- names: editorial_board, editorial_extended, author_metadata, archive_issues,
--        nav_footer, social_media, article_types, homepage
CREATE TABLE IF NOT EXISTS singletons (
  name VARCHAR(64) PRIMARY KEY,
  data JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
