<?php
/**
 * Nav/footer template — structured model -> exact <nav>/<footer> HTML.
 * PHP port of admin/lib/nav-footer-template.js. Byte-verified against Node.
 */
class NavFooterTemplate
{
    private static function esc($s): string
    {
        return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], (string)($s ?? ''));
    }

    private static function textToParagraphs($text, ?string $pClass): string
    {
        $cls = $pClass ? " class=\"$pClass\"" : '';
        $blocks = preg_split('/\n\s*\n/', (string)($text ?? ''));
        $out = [];
        foreach ($blocks as $block) {
            $block = trim($block);
            if ($block === '') continue;
            $lines = array_map(fn($l) => self::esc(trim($l)), explode("\n", $block));
            $out[] = "<p$cls>" . implode('<br>', $lines) . '</p>';
        }
        return implode("\n          ", $out);
    }

    private const SOCIAL_BLOCK = '<a href="https://www.instagram.com/balkanmedj/" target="_blank" rel="noopener" aria-label="Instagram" class="text-teal-300 hover:text-white transition-colors"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></a>
              <a href="https://x.com/balkanmedj" target="_blank" rel="noopener" aria-label="X (Twitter)" class="text-teal-300 hover:text-white transition-colors"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
              <a href="https://www.linkedin.com/company/balkan-med-j/" target="_blank" rel="noopener" aria-label="LinkedIn" class="text-teal-300 hover:text-white transition-colors"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>';

    private static function navItemHtml(array $item): string
    {
        if (($item['type'] ?? '') === 'dropdown') {
            $subs = [];
            foreach ($item['children'] ?? [] as $c) {
                $subs[] = '              <a href="' . self::esc($c['url'] ?? '') . '" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-teal-700">' . self::esc($c['label'] ?? '') . '</a>';
            }
            $subsHtml = implode("\n", $subs);
            $label = self::esc($item['label'] ?? '');
            return "          <div class=\"relative group\">\n"
                . "            <button data-dropdown-trigger class=\"px-3 py-2 text-base font-medium text-gray-700 hover:text-teal-700 rounded-lg hover:bg-gray-50 transition-colors inline-flex items-center whitespace-nowrap\">\n"
                . "              $label\n"
                . "              <svg class=\"ml-1 w-4 h-4\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 9l-7 7-7-7\"/></svg>\n"
                . "            </button>\n"
                . "            <div class=\"nav-dropdown absolute left-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50\">\n"
                . "$subsHtml\n"
                . "            </div>\n"
                . "          </div>";
        }
        $url = self::esc($item['url'] ?? '');
        return '          <a href="' . $url . '" data-nav-page="' . $url . '" class="px-3 py-2 text-base font-medium text-gray-700 hover:text-teal-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap">' . self::esc($item['label'] ?? '') . '</a>';
    }

    public static function buildNavHtml(array $nav): string
    {
        $items = implode("\n", array_map([self::class, 'navItemHtml'], $nav['items'] ?? []));
        $submitLabel = self::esc($nav['submitLabel'] ?? 'Submit Manuscript');
        $submitUrl = self::esc($nav['submitUrl'] ?? '#');
        return <<<HTML
<nav class="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm" aria-label="Main navigation">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-24">
        <!-- Logo -->
        <a href="index.html" class="flex items-center space-x-2 flex-shrink-0" aria-label="Balkan Medical Journal Home">
          <img src="images/logo.png" alt="Balkan Medical Journal" class="h-20 w-auto">
        </a>

        <!-- Desktop Nav -->
        <div class="hidden lg:flex items-center space-x-1">
$items
        </div>

        <!-- Submit CTA + Mobile toggle -->
        <div class="flex items-center space-x-3">
          <button data-search-toggle class="p-2 text-gray-700 hover:text-teal-700 rounded-lg hover:bg-gray-50 transition-colors lg:hidden" aria-label="Search articles" title="Search (Ctrl+K)">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </button>
          <button data-search-toggle class="hidden lg:flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-teal-700 transition-colors shadow-sm whitespace-nowrap" aria-label="Search articles" title="Search (Ctrl+K)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <span>Search</span>
          </button>
          <a href="$submitUrl" class="hidden sm:inline-flex items-center px-4 py-2 bg-red-700 text-white text-sm font-semibold rounded-lg hover:bg-red-800 transition-colors shadow-sm whitespace-nowrap">
            $submitLabel
            <svg class="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
          </a>
          <button id="mobile-menu-btn" class="lg:hidden p-2 text-gray-700 hover:text-teal-700 rounded-lg hover:bg-gray-50" aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        </div>
      </div>
    </div>
  </nav>
HTML;
    }

    private static function footerColumnHtml(array $col): string
    {
        $links = [];
        foreach ($col['links'] ?? [] as $l) {
            $links[] = '            <li><a href="' . self::esc($l['url'] ?? '') . '" class="hover:text-white transition-colors">' . self::esc($l['label'] ?? '') . '</a></li>';
        }
        $linksHtml = implode("\n", $links);
        $title = self::esc($col['title'] ?? '');
        return "        <!-- $title -->\n        <div>\n          <h3 class=\"font-semibold text-lg mb-4\">$title</h3>\n          <ul class=\"space-y-2 text-teal-300 text-sm\">\n$linksHtml\n          </ul>\n        </div>";
    }

    public static function buildFooterHtml(array $footer): string
    {
        $columns = implode("\n", array_map([self::class, 'footerColumnHtml'], $footer['columns'] ?? []));
        $brandText = self::textToParagraphs($footer['brandText'] ?? '', 'text-teal-300 text-sm leading-relaxed');
        $contactText = self::textToParagraphs($footer['contactText'] ?? '', null);
        $email = self::esc($footer['contactEmail'] ?? '');
        $emailLine = $email ? '<p><a href="mailto:' . $email . '" class="hover:text-white transition-colors">' . $email . '</a></p>' : '';
        $brandTitle = self::esc($footer['brandTitle'] ?? 'Balkan Medical Journal');
        $contactTitle = self::esc($footer['contactTitle'] ?? 'Contact');
        $copyright = self::esc($footer['copyright'] ?? '');
        $licenseText = self::esc($footer['licenseText'] ?? '');
        $social = self::SOCIAL_BLOCK;
        return <<<HTML
<footer class="bg-teal-900 text-white" aria-label="Site footer">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <!-- Brand -->
        <div>
          <div class="flex items-center space-x-2 mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden">
              <img src="images/logo.png" alt="Balkan Medical Journal" class="h-12 w-12 object-contain">
            </div>
            <div>
              <div class="font-bold text-lg">$brandTitle</div>
            </div>
          </div>
          $brandText
        </div>

$columns

        <!-- Contact -->
        <div>
          <h3 class="font-semibold text-lg mb-4">$contactTitle</h3>
          <div class="text-teal-300 text-sm space-y-2">
          $contactText
          $emailLine
            <div class="flex items-center gap-4 mt-3">
              $social
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-teal-800 mt-10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <p class="text-teal-400 text-sm">$copyright</p>
        <div class="flex items-center gap-6 text-teal-400 text-sm">
          <span>$licenseText</span>
          <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/" target="_blank" rel="noopener" class="hover:text-white transition-colors" aria-label="Creative Commons License">
            <img src="images/icons/cc-by-nc-nd.svg" alt="CC BY-NC-ND 4.0" class="h-6 w-auto opacity-70 hover:opacity-100 transition-opacity">
          </a>
        </div>
      </div>
    </div>
  </footer>
HTML;
    }

    public static function defaultModel(): array
    {
        $p = dirname(__DIR__) . '/data/nav-footer-default.json';
        return is_file($p) ? (json_decode((string)file_get_contents($p), true) ?: []) : [];
    }

    public static function buildNavFooterData($model): array
    {
        $m = (is_array($model) && !empty($model['nav']) && !empty($model['footer'])) ? $model : self::defaultModel();
        return [
            '_note' => 'Form tabanlı düzenleyici ile yönetilir. nav/footer = yapısal model, navHtml/footerHtml = üretilen kod.',
            'nav' => $m['nav'],
            'footer' => $m['footer'],
            'navHtml' => self::buildNavHtml($m['nav']),
            'footerHtml' => self::buildFooterHtml($m['footer']),
        ];
    }
}
