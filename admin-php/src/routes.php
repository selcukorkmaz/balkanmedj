<?php
/**
 * Route table. Returns a configured Router. Grows per migration phase.
 * Paths are relative to "/api" (the front controller strips the base + /api).
 */

/** @var Router $r */
$r = new Router();

// --- Auth (open; no session required) ---------------------------------------
$r->post('/auth/login',           fn() => Auth::login());
$r->post('/auth/logout',          fn() => Auth::logout());
$r->get('/auth/me',               fn() => Auth::me());
$r->post('/auth/change-password', fn() => Auth::changePassword());

// --- Articles ---------------------------------------------------------------
$r->get('/articles',                  fn() => Repo\Articles::handleList());
$r->post('/articles',                 fn() => Repo\Articles::handleCreate());
$r->post('/articles/move',            fn() => Repo\Articles::handleMove());
$r->get('/articles/:id/fulltext',     fn($p) => Repo\Articles::handleGetFullText($p));
$r->put('/articles/:id/fulltext',     fn($p) => Repo\Articles::handlePutFullText($p));
$r->get('/articles/:id',              fn($p) => Repo\Articles::handleGet($p));
$r->put('/articles/:id',              fn($p) => Repo\Articles::handleUpdate($p));
$r->delete('/articles/:id',           fn($p) => Repo\Articles::handleDelete($p));
$r->post('/articles/:id/return-to-in-press', fn($p) => Repo\Articles::handleReturnToInPress($p));
$r->put('/articles/:id/metrics',             fn($p) => Repo\Articles::handleMetrics($p));
$r->post('/articles/:id/link',               fn($p) => Repo\Articles::handleAddLink($p));
$r->delete('/articles/:id/link/:targetId',   fn($p) => Repo\Articles::handleDeleteLink($p));

// --- Stats ------------------------------------------------------------------
$r->get('/stats',              fn() => Repo\Stats::handleStats());
$r->get('/stats/top-articles', fn() => Repo\Stats::handleTopArticles());

// --- Articles in press ------------------------------------------------------
$r->get('/articles-in-press',              fn() => Repo\ArticlesInPress::handleList());
$r->post('/articles-in-press/parse-docx',  fn() => Repo\ArticlesInPress::handleParseDocx());
$r->post('/articles-in-press/reorder',     fn() => Repo\ArticlesInPress::handleReorder());
$r->post('/articles-in-press/publish',     fn() => Repo\ArticlesInPress::handlePublishBatch());
$r->post('/articles-in-press/:id/publish', fn($p) => Repo\ArticlesInPress::handlePublish($p));
$r->get('/articles-in-press/:id/fulltext', fn($p) => Repo\ArticlesInPress::handleGetFullText($p));
$r->put('/articles-in-press/:id/fulltext', fn($p) => Repo\ArticlesInPress::handlePutFullText($p));
$r->get('/articles-in-press/:id',          fn($p) => Repo\ArticlesInPress::handleGet($p));
$r->put('/articles-in-press/:id',          fn($p) => Repo\ArticlesInPress::handleUpdate($p));
$r->delete('/articles-in-press/:id',       fn($p) => Repo\ArticlesInPress::handleDelete($p));
$r->post('/articles-in-press',             fn() => Repo\ArticlesInPress::handleCreate());

// --- SEO regenerate ---------------------------------------------------------
$r->post('/seo/regenerate', function () {
    $r = Export\Seo::regenerate(Repo\Articles::all(), Repo\ArticlesInPress::all());
    Http::json(['ok' => true] + $r);
});

// --- News -------------------------------------------------------------------
$r->get('/news',         fn() => Repo\News::handleList());
$r->post('/news',        fn() => Repo\News::handleCreate());
$r->get('/news/:id',     fn($p) => Repo\News::handleGet($p));
$r->put('/news/:id',     fn($p) => Repo\News::handleUpdate($p));
$r->delete('/news/:id',  fn($p) => Repo\News::handleDelete($p));

// --- Editorial board --------------------------------------------------------
$r->get('/editorial',           fn() => Repo\Editorial::handleGetBoard());
$r->put('/editorial',           fn() => Repo\Editorial::handlePutBoard());
$r->get('/editorial/extended',  fn() => Repo\Editorial::handleGetExtended());
$r->put('/editorial/extended',  fn() => Repo\Editorial::handlePutExtended());

// --- Homepage ---------------------------------------------------------------
$r->get('/homepage',        fn() => Repo\Homepage::handleGet());
$r->put('/homepage',        fn() => Repo\Homepage::handlePut());
$r->get('/homepage/popup',  fn() => Repo\Homepage::handleGetPopup());
$r->put('/homepage/popup',  fn() => Repo\Homepage::handlePutPopup());
$r->get('/homepage/sections', fn() => Repo\Homepage::handleGetSections());
$r->put('/homepage/sections', fn() => Repo\Homepage::handlePutSections());

// --- Article types ----------------------------------------------------------
$r->get('/article-types',          fn() => Repo\ArticleTypes::handleList());
$r->post('/article-types',         fn() => Repo\ArticleTypes::handleAdd());
$r->put('/article-types/rename',   fn() => Repo\ArticleTypes::handleRename());
$r->delete('/article-types/:name', fn($p) => Repo\ArticleTypes::handleDelete($p));

// --- Issues -----------------------------------------------------------------
$r->get('/issues',                              fn() => Repo\Issues::handleList());
$r->post('/issues',                             fn() => Repo\Issues::handleCreate());
$r->post('/issues/:volume/:issue/rebuild',      fn($p) => Repo\Issues::handleRebuild($p));
$r->get('/issues/:volume/:issue/articles',      fn($p) => Repo\Issues::handleGetArticles($p));
$r->get('/issues/:volume/:issue/files',         fn($p) => Repo\Issues::handleGetFiles($p));
$r->post('/issues/:volume/:issue/set-current',  fn($p) => Repo\Issues::handleSetCurrent($p));
$r->delete('/issues/:year/:volume/:issue',      fn($p) => Repo\Issues::handleDelete($p));
$r->post('/issues/:volume/:issue/files/:type',   fn($p) => Repo\Issues::handleUploadFile($p));
$r->delete('/issues/:volume/:issue/files/:type', fn($p) => Repo\Issues::handleDeleteFile($p));

// --- Media uploads ----------------------------------------------------------
$r->post('/media/upload/pdf',             fn() => Repo\Media::uploadPdf());
$r->post('/media/upload/image',           fn() => Repo\Media::uploadImage());
$r->post('/media/upload/video',           fn() => Repo\Media::uploadVideo());
$r->post('/media/upload/document',        fn() => Repo\Media::uploadDocument());
$r->post('/media/upload/editorial-photo', fn() => Repo\Media::uploadEditorialPhoto());
$r->post('/media/upload/editorial-cv',    fn() => Repo\Media::uploadEditorialCv());
$r->post('/media/upload/pdf-batch',       fn() => Repo\Media::uploadPdfBatch());
$r->post('/media/upload/figures/:articleId',       fn($p) => Repo\Media::uploadFigures($p));
$r->post('/media/upload/supplementary/:articleId', fn($p) => Repo\Media::uploadSupplementary($p));
$r->get('/media/article/:articleId/figure-meta',   fn($p) => Repo\Media::getFigureMeta($p));
$r->put('/media/article/:articleId/figure-meta',   fn($p) => Repo\Media::putFigureMeta($p));
$r->delete('/media/article/:articleId/figures/:filename', fn($p) => Repo\Media::deleteFigure($p));
$r->get('/media/article/:articleId/assets',        fn($p) => Repo\Media::getAssets($p));
$r->get('/media/article/:articleId/figure-status', fn($p) => Repo\Media::figureStatus($p));
$r->post('/media/figures/:articleId/apply',        fn($p) => Repo\Media::figuresApply($p));
$r->get('/media/stats',        fn() => Repo\Media::stats());
$r->get('/media/missing-pdfs', fn() => Repo\Media::missingPdfs());

// --- Supplementary library --------------------------------------------------
$r->get('/supp-library',            fn() => Repo\SuppLibrary::handleList());
$r->post('/supp-library/upload',    fn() => Repo\SuppLibrary::handleUpload());
$r->post('/supp-library/:name/replace', fn($p) => Repo\SuppLibrary::handleReplace($p));
$r->post('/supp-library/:name/rename',  fn($p) => Repo\SuppLibrary::handleRename($p));
$r->delete('/supp-library/:name',   fn($p) => Repo\SuppLibrary::handleDelete($p));

// --- Backups ----------------------------------------------------------------
$r->post('/backup',                  fn() => Backup::handleCreate());
$r->get('/backups',                  fn() => Backup::handleList());
$r->get('/backups/:name/download',   fn($p) => Backup::handleDownload($p));

// --- JATS XML import --------------------------------------------------------
$r->post('/jats/parse',       fn() => Repo\Jats::handleParse());
$r->post('/jats/parse-batch', fn() => Repo\Jats::handleParseBatch());
$r->post('/jats/import',      fn() => Repo\Jats::handleImport());
$r->post('/jats/import-batch', fn() => Repo\Jats::handleImportBatch());
$r->post('/jats/import-in-press', fn() => Repo\Jats::handleImportInPress());

// --- Social media -----------------------------------------------------------
$r->get('/social-media/platforms', fn() => Repo\Social::handlePlatforms());
$r->get('/social-media',           fn() => Repo\Social::handleGet());
$r->put('/social-media',           fn() => Repo\Social::handlePut());

// --- ZIP bulk import --------------------------------------------------------
$r->get('/imports/scan',                fn() => Repo\Imports::handleScan());
$r->post('/imports/upload',             fn() => Repo\Imports::handleUpload());
$r->get('/imports/preview/:filename',   fn($p) => Repo\Imports::handlePreview($p));
$r->post('/imports/process/:filename',  fn($p) => Repo\Imports::handleProcess($p));
$r->delete('/imports/:filename',        fn($p) => Repo\Imports::handleDelete($p));

// --- Pages + short links ----------------------------------------------------
$r->get('/pages',                       fn() => Repo\Pages::handleList());
$r->post('/pages',                      fn() => Repo\Pages::handleCreate());
$r->get('/short-links',                 fn() => Repo\Pages::handleShortLinks());
$r->put('/pages/:slug/short-code',      fn($p) => Repo\Pages::handleSetShortCode($p));
$r->delete('/pages/:slug/short-code',   fn($p) => Repo\Pages::handleRemoveShortCode($p));
$r->get('/pages/:slug',                 fn($p) => Repo\Pages::handleGet($p));
$r->put('/pages/:slug',                 fn($p) => Repo\Pages::handlePut($p));
$r->delete('/pages/:slug',              fn($p) => Repo\Pages::handleDelete($p));

// --- Nav / footer (model persistence; page-wide sync pending) ---------------
$r->get('/nav-footer',         fn() => Repo\NavFooter::handleGet());
$r->put('/nav-footer',         fn() => Repo\NavFooter::handlePut());
$r->post('/nav-footer/reset',  fn() => Repo\NavFooter::handleReset());
$r->post('/nav-footer/sync',   fn() => Repo\NavFooter::handleSync());
$r->post('/social-media/sync', fn() => Repo\Social::handleSync());

return $r;
