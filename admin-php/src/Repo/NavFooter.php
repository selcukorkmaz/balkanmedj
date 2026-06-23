<?php
namespace Repo;

/**
 * Nav/footer model persistence + page-wide sync. Stored in the `nav_footer`
 * singleton. Port of admin/server.js /api/nav-footer routes (+ html-sync.js,
 * nav-footer-template.js).
 */
class NavFooter
{
    public static function handleGet(): void
    {
        $data = Store::get('nav_footer', null);
        if (!is_array($data) || empty($data['nav']) || empty($data['footer'])) {
            $data = \HtmlSync::bootstrapNavFooterData();
        }
        \Http::json($data);
    }

    public static function handlePut(): void
    {
        \Backup::snapshot();
        $body = \Http::body();
        if (!empty($body['nav']) && !empty($body['footer'])) {
            // Form editor: regenerate navHtml/footerHtml from the structured model.
            $data = \NavFooterTemplate::buildNavFooterData($body);
        } else {
            // Advanced HTML tab: store raw HTML, keep the existing model.
            $existing = Store::get('nav_footer', []);
            if (!is_array($existing)) $existing = [];
            $data = array_merge($existing, [
                'navHtml' => $body['navHtml'] ?? ($existing['navHtml'] ?? ''),
                'footerHtml' => $body['footerHtml'] ?? ($existing['footerHtml'] ?? ''),
            ]);
        }
        Store::put('nav_footer', $data);
        \Http::json(['saved' => true]);
    }

    /** Re-seed from the default model. */
    public static function handleReset(): void
    {
        \Backup::snapshot();
        $data = \NavFooterTemplate::buildNavFooterData(\NavFooterTemplate::defaultModel());
        Store::put('nav_footer', $data);
        \Http::json($data);
    }

    /** Inject current nav/footer HTML into every public page. */
    public static function handleSync(): void
    {
        \Backup::snapshot();
        \Http::json(\HtmlSync::syncAllPages());
    }
}
