<?php
/**
 * Custom-page slug helpers + HTML template generation.
 * PHP port of admin/lib/page-template.js.
 */
class PageTemplate
{
    public const RESERVED_SLUGS = [
        'index', 'about', 'editorial-board', 'current-issue', 'articles-in-press',
        'archive', 'article', 'for-authors', 'for-reviewers', 'policies', 'news',
        'news-article', 'contact', 'forms', 'journal-metrics', 'search-results',
    ];

    public static function normalizeSlug($input): string
    {
        $s = mb_strtolower(trim((string)$input), 'UTF-8');
        $s = preg_replace('/[^a-z0-9\s-]/', '', $s);
        $s = preg_replace('/\s+/', '-', $s);
        $s = preg_replace('/-+/', '-', $s);
        return preg_replace('/^-|-$/', '', $s);
    }

    public static function validateSlug(string $slug): ?string
    {
        if (!$slug) return 'Slug boş olamaz';
        if (!preg_match('/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/', $slug)) {
            return 'Slug yalnızca küçük harf, rakam ve tire içerebilir';
        }
        if (in_array($slug, self::RESERVED_SLUGS, true)) return 'Bu slug sistem sayfaları için ayrılmıştır';
        return null;
    }

    private static function esc($s): string
    {
        return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'], (string)($s ?? ''));
    }

    /** Clone journal-metrics.html's shell, rewrite head + main. */
    public static function createPageHtml(string $slug, string $title, string $description): string
    {
        $src = \Config::projectRoot() . '/journal-metrics.html';
        if (!is_file($src)) throw new \HttpError('Şablon dosyası bulunamadı: journal-metrics.html', 500);
        $source = (string)file_get_contents($src);

        $safeTitle = self::esc($title);
        $safeDesc = self::esc($description ?: "$title — Balkan Medical Journal");
        $url = "https://balkanmedicaljournal.org/$slug.html";

        $newHead = "<head>\n"
            . "  <meta charset=\"UTF-8\">\n"
            . "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
            . "  <title>$safeTitle — Balkan Medical Journal</title>\n"
            . "  <meta name=\"description\" content=\"$safeDesc\">\n"
            . "  <meta property=\"og:title\" content=\"$safeTitle — Balkan Medical Journal\">\n"
            . "  <meta property=\"og:description\" content=\"$safeDesc\">\n"
            . "  <meta property=\"og:type\" content=\"website\">\n"
            . "  <meta property=\"og:url\" content=\"$url\">\n"
            . "  <meta property=\"og:image\" content=\"https://balkanmedicaljournal.org/images/cover/cover1.jpeg\">\n"
            . "  <meta name=\"twitter:card\" content=\"summary_large_image\">\n"
            . "  <meta name=\"twitter:title\" content=\"$safeTitle — Balkan Medical Journal\">\n"
            . "  <meta name=\"twitter:description\" content=\"$safeDesc\">\n"
            . "  <meta name=\"twitter:image\" content=\"https://balkanmedicaljournal.org/images/cover/cover1.jpeg\">\n"
            . "  <link rel=\"icon\" href=\"images/favicon.ico\" type=\"image/x-icon\">\n"
            . "  <link rel=\"icon\" href=\"images/favicon-32x32.png\" type=\"image/png\" sizes=\"32x32\">\n"
            . "  <link rel=\"apple-touch-icon\" href=\"images/apple-touch-icon.png\">\n"
            . "  <link rel=\"stylesheet\" href=\"css/style.css\">\n"
            . "</head>";
        $html = preg_replace('/<head>.*?<\/head>/s', self::pregReplacementSafe($newHead), $source, 1);

        $newMain = "<main id=\"main-content\">\n\n"
            . "    <div class=\"bg-gray-50 border-b border-gray-200\">\n"
            . "      <div class=\"max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3\">\n"
            . "        <nav aria-label=\"Breadcrumb\">\n          <ol class=\"flex items-center space-x-2 text-sm text-gray-500\">\n"
            . "            <li><a href=\"index.html\" class=\"hover:text-teal-700 transition-colors\">Home</a></li>\n"
            . "            <li><svg class=\"w-4 h-4 text-gray-400\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M9 5l7 7-7 7\"/></svg></li>\n"
            . "            <li><span class=\"text-gray-900 font-medium\" aria-current=\"page\">$safeTitle</span></li>\n"
            . "          </ol>\n        </nav>\n      </div>\n    </div>\n\n"
            . "    <div class=\"bg-white border-b border-gray-200\">\n"
            . "      <div class=\"max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10\">\n"
            . "        <h1 class=\"text-3xl md:text-4xl font-bold text-gray-900\">$safeTitle</h1>\n"
            . "        <p class=\"mt-2 text-gray-500 text-lg font-serif\">$safeDesc</p>\n"
            . "      </div>\n    </div>\n\n"
            . "    <section class=\"py-12 bg-white\">\n"
            . "      <div class=\"max-w-7xl mx-auto px-4 sm:px-6 lg:px-8\">\n"
            . "        <div class=\"prose prose-gray max-w-none text-gray-700 leading-relaxed space-y-4\">\n"
            . "          <p>Bu sayfanın içeriğini yönetim panelinden düzenleyebilirsiniz.</p>\n"
            . "        </div>\n      </div>\n    </section>\n\n"
            . "  </main>";
        $html = preg_replace('/<main\s+id="main-content"[^>]*>.*?<\/main>/s', self::pregReplacementSafe($newMain), $html, 1);

        return $html;
    }

    /** Escape $ and \ so a literal replacement string is safe in preg_replace. */
    private static function pregReplacementSafe(string $s): string
    {
        return str_replace(['\\', '$'], ['\\\\', '\\$'], $s);
    }
}
