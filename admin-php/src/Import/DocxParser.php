<?php
namespace Import;

/**
 * Extract AIP metadata + full-text body from a Galenos-style .docx.
 * PHP port of admin/lib/docx-parser.js (regex-over-OOXML + ZipArchive).
 * parseDate is delegated to the shared \Dates helper (identical logic).
 */
class DocxParser
{
    public static function parseAipDocx(string $path): array
    {
        $zip = new \ZipArchive();
        if ($zip->open($path) !== true) throw new \HttpError('Geçersiz .docx', 400);
        $xml = $zip->getFromName('word/document.xml');
        if ($xml === false) { $zip->close(); throw new \HttpError('Geçersiz .docx: word/document.xml bulunamadı', 400); }

        $paragraphs = self::extractParagraphs($xml);
        $meta = self::extractMetadata($paragraphs);

        try {
            $rels = self::buildRelsMap($zip);
            $rich = self::extractRichParagraphs($xml, $rels);
            $body = self::buildBodyHtml($rich, ['type' => $meta['type']]);
            $meta['fullTextHtml'] = $body['html'];
            $meta['fullTextHeadingCount'] = $body['headingCount'];
            if (!$meta['fullTextHtml']) $meta['warnings'][] = 'Tam metin gövdesi bulunamadı (başlıklar tespit edilemedi)';
            elseif ($body['headingCount'] > 0) $meta['headingCheckReminder'] = true;
        } catch (\Throwable $e) {
            $meta['fullTextHtml'] = '';
            $meta['warnings'][] = 'Tam metin çıkarılamadı: ' . $e->getMessage();
        }
        $zip->close();
        return $meta;
    }

    private static function esc($s): string { return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], (string)$s); }
    private static function escAttr($s): string { return str_replace('"', '&quot;', self::esc($s)); }
    private static function decode($s): string
    {
        return str_replace(['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'], ['&', '<', '>', '"', "'"], (string)$s);
    }

    private static function buildRelsMap(\ZipArchive $zip): array
    {
        $map = [];
        $xml = $zip->getFromName('word/_rels/document.xml.rels');
        if ($xml === false) return $map;
        if (preg_match_all('/<Relationship\b[^>]*\/?>/', $xml, $mm)) {
            foreach ($mm[0] as $tag) {
                $id = preg_match('/\bId="([^"]+)"/', $tag, $a) ? $a[1] : null;
                $target = preg_match('/\bTarget="([^"]+)"/', $tag, $b) ? $b[1] : null;
                if ($id && $target) $map[$id] = self::decode($target);
            }
        }
        return $map;
    }

    private static function rprToggleOn(string $rpr, string $name): bool
    {
        if (!preg_match('/<w:' . $name . '\b([^>]*)\/?>/', $rpr, $m)) return false;
        $v = preg_match('/w:val="([^"]*)"/', $m[1], $vm) ? $vm[1] : '';
        return !($v && preg_match('/^(0|false|off)$/i', $v));
    }

    private static function runToHtml(string $runXml): array
    {
        $rpr = preg_match('/<w:rPr\b[^>]*>(.*?)<\/w:rPr>/s', $runXml, $m) ? $m[1] : '';
        $bold = self::rprToggleOn($rpr, 'b');
        $italic = self::rprToggleOn($rpr, 'i');
        $vert = preg_match('/<w:vertAlign\b[^>]*w:val="([^"]+)"/', $rpr, $vm) ? $vm[1] : '';

        $plain = '';
        if (preg_match_all('/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/s', $runXml, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $tk) {
                if (str_contains($tk[0], '</w:t>')) $plain .= self::decode($tk[1] ?? '');
                elseif (preg_match('/<w:tab\b/', $tk[0])) $plain .= "\t";
                else $plain .= "\n";
            }
        }
        if ($plain === '') return ['html' => '', 'plain' => ''];

        $html = str_replace("\n", '<br>', self::esc($plain));
        if ($vert === 'superscript') $html = "<sup>$html</sup>";
        elseif ($vert === 'subscript') $html = "<sub>$html</sub>";
        if ($italic) $html = "<em>$html</em>";
        if ($bold) $html = "<strong>$html</strong>";
        return ['html' => $html, 'plain' => $plain];
    }

    private static function paraInnerToHtml(string $inner, array $rels): array
    {
        $html = ''; $plain = '';
        if (preg_match_all('/<w:hyperlink\b([^>]*)>(.*?)<\/w:hyperlink>|<w:r\b[^>]*>.*?<\/w:r>/s', $inner, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $m) {
                if (isset($m[2]) && strpos($m[0], '<w:hyperlink') === 0) {
                    $rid = preg_match('/r:id="([^"]+)"/', $m[1], $rm) ? $rm[1] : '';
                    $href = $rid ? ($rels[$rid] ?? '') : '';
                    $sub = ''; $subPlain = '';
                    if (preg_match_all('/<w:r\b[^>]*>.*?<\/w:r>/s', $m[2], $rr)) {
                        foreach ($rr[0] as $run) { $o = self::runToHtml($run); $sub .= $o['html']; $subPlain .= $o['plain']; }
                    }
                    $html .= $href ? '<a href="' . self::escAttr($href) . '" target="_blank" rel="noopener">' . $sub . '</a>' : $sub;
                    $plain .= $subPlain;
                } else {
                    $o = self::runToHtml($m[0]);
                    $html .= $o['html']; $plain .= $o['plain'];
                }
            }
        }
        return ['html' => trim($html), 'plain' => trim(str_replace("\t", ' ', $plain))];
    }

    private static function paragraphToken(string $inner, array $rels): array
    {
        $ppr = preg_match('/<w:pPr\b[^>]*>(.*?)<\/w:pPr>/s', $inner, $m) ? $m[1] : '';
        $isList = (bool)preg_match('/<w:numPr\b/', $ppr);
        $styleId = preg_match('/<w:pStyle\b[^>]*w:val="([^"]+)"/', $ppr, $sm) ? $sm[1] : '';
        $outlineRaw = preg_match('/<w:outlineLvl\b[^>]*w:val="([^"]+)"/', $ppr, $om) ? $om[1] : null;
        $r = self::paraInnerToHtml($inner, $rels);
        return ['type' => 'p', 'html' => $r['html'], 'plain' => $r['plain'], 'isList' => $isList,
                'styleId' => $styleId, 'outline' => $outlineRaw !== null ? (int)$outlineRaw : null];
    }

    private static function tableToken(string $tblXml, array $rels): array
    {
        $rows = '';
        if (preg_match_all('/<w:tr\b[^>]*>(.*?)<\/w:tr>/s', $tblXml, $trs, PREG_SET_ORDER)) {
            foreach ($trs as $tr) {
                $trInner = $tr[1];
                $trPr = preg_match('/<w:trPr\b[^>]*>(.*?)<\/w:trPr>/s', $trInner, $tp) ? $tp[1] : '';
                $cellTag = preg_match('/<w:tblHeader\b/', $trPr) ? 'th' : 'td';
                $cells = '';
                if (preg_match_all('/<w:tc\b[^>]*>(.*?)<\/w:tc>/s', $trInner, $tcs, PREG_SET_ORDER)) {
                    foreach ($tcs as $tc) {
                        $parts = [];
                        if (preg_match_all('/<w:p\b[^>]*>(.*?)<\/w:p>/s', $tc[1], $ps, PREG_SET_ORDER)) {
                            foreach ($ps as $p) { $h = self::paraInnerToHtml($p[1], $rels)['html']; if ($h) $parts[] = $h; }
                        }
                        $cells .= "<$cellTag>" . implode('<br>', $parts) . "</$cellTag>";
                    }
                }
                if ($cells) $rows .= "<tr>$cells</tr>";
            }
        }
        return ['type' => 'table', 'plain' => '', 'html' => $rows ? '<table class="article-table"><tbody>' . $rows . '</tbody></table>' : ''];
    }

    private static function extractRichParagraphs(string $xml, array $rels): array
    {
        $tokens = [];
        if (preg_match_all('/<w:tbl\b[^>]*>(.*?)<\/w:tbl>|<w:p\b[^>]*>(.*?)<\/w:p>/s', $xml, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $m) {
                if (strpos($m[0], '<w:tbl') === 0) $tokens[] = self::tableToken($m[1], $rels);
                else $tokens[] = self::paragraphToken($m[2] ?? '', $rels);
            }
        }
        return $tokens;
    }

    private static function explicitHeadingLevel(array $p): ?int
    {
        $style = (string)($p['styleId'] ?? '');
        if (preg_match('/(?:heading|Ba_?l_?k|Başlık|Baslik)\s*([1-9])/iu', $style, $m)) return (int)$m[1];
        if (preg_match('/^Heading([1-9])$/i', $style, $m)) return (int)$m[1];
        if (($p['outline'] ?? null) !== null) return $p['outline'] + 1;
        return null;
    }

    private static function normalizeHeading($text): string
    {
        $t = preg_replace('/\s+/', ' ', (string)$text);
        $t = trim($t);
        $t = preg_replace('/^[\d.]+[).]?\s+/', '', $t);
        $t = preg_replace('/[:.\s]+$/', '', $t);
        return mb_strtolower($t, 'UTF-8');
    }

    private const SECT_METHODS = '/^(materials? and methods|material and methods|patients? and methods|subjects? and methods|methods?|methodology|gereç ve yöntem(ler)?|gerec ve yöntem(ler)?|materyal ve met[oy]t?|yöntem(ler)?|yontem(ler)?)$/u';
    private const SECT_COMMON = [
        '/^introduction$/u', '/^giriş$/u', '/^giris$/u', '/^results? and discussions?$/u',
        '/^results?$/u', '/^findings$/u', '/^bulgular$/u', '/^discussions?$/u', '/^tartışma$/u', '/^tartisma$/u',
        '/^conclusions?$/u', '/^concluding remarks$/u', '/^sonuç(lar)?$/u', '/^sonuc(lar)?$/u',
        '/^references$/u', '/^kaynaklar$/u', '/^kaynakça$/u', '/^kaynakca$/u',
        '/^abstract$/u', '/^öz$/u', '/^özet$/u', '/^ozet$/u',
    ];
    private const SECT_CASE = ['/^case (report|reports|presentation|description|series)$/u', '/^olgu( sunumu)?$/u', '/^vaka( sunumu)?$/u'];
    private const SECT_BACKMATTER = [
        '/^acknowledge?ments?$/u', '/^acknowledgements?$/u', '/^teşekkür$/u', '/^tesekkur$/u',
        '/^fundings?$/u', '/^financial (support|disclosure|disclosures)$/u', '/^funding (information|statement|sources?)$/u',
        '/^conflicts? of interest$/u', '/^disclosures?$/u', '/^competing interests?$/u', '/^declaration of (competing )?interest(s)?$/u',
        '/^(author|authors\'?|authorship) contributions?$/u', '/^yazar katkı(ları)?$/u',
        '/^ethics?( statement| approval)?$/u', '/^ethical (approval|statement|considerations?)$/u',
        '/^data availability( statement)?$/u', '/^abbreviations?$/u',
    ];

    private static function anyMatch(array $patterns, string $s): bool
    {
        foreach ($patterns as $re) if (preg_match($re, $s)) return true;
        return false;
    }
    private static function isMainSection(string $norm, bool $isOriginal): bool
    {
        if (preg_match(self::SECT_METHODS, $norm)) return true;
        if (self::anyMatch(self::SECT_COMMON, $norm)) return true;
        if (self::anyMatch(self::SECT_BACKMATTER, $norm)) return true;
        if (!$isOriginal && self::anyMatch(self::SECT_CASE, $norm)) return true;
        return false;
    }
    private static function isOriginalType($type): bool
    {
        return (bool)preg_match('/\boriginal\b|\borijinal\b|research article|original research|özgün araştırma|ozgun arastirma|araştırma makale|arastirma makale/iu', (string)$type);
    }

    private static function looksLikeHeading(array $p): bool
    {
        if (self::explicitHeadingLevel($p) !== null) return true;
        if (self::isLikelyBodyHeading($p['plain'])) return true;
        if (!empty($p['plain']) && mb_strlen($p['plain']) <= 80 && self::isMainSection(self::normalizeHeading($p['plain']), false)) return true;
        return false;
    }
    private static function classifyHeadingLevel(array $p, array $ctx): string
    {
        $norm = self::normalizeHeading($p['plain']);
        if (self::isMainSection($norm, $ctx['isOriginal'])) return 'h3';
        if ($ctx['seenMain']) return 'h4';
        $explicit = self::explicitHeadingLevel($p);
        if ($explicit !== null && $explicit >= 2) return 'h4';
        return 'h3';
    }
    private static function looksLikeKeywordList($text): bool
    {
        $t = trim((string)$text);
        if (!$t || mb_strlen($t) > 160) return false;
        $parts = array_filter(array_map('trim', preg_split('/[,;]/', $t)));
        if (!$parts) return false;
        foreach ($parts as $p) if (count(preg_split('/\s+/', $p)) > 6) return false;
        return true;
    }
    private static function typeHasAbstract($type): bool
    {
        return !preg_match('/editorial|letter|clinical image|scientific letter|editorial comment|commentary|\bimage\b/i', mb_strtolower((string)$type, 'UTF-8'));
    }

    private static function firstNonMetadataIndex(array $paras): int
    {
        $sawDoi = false; $sawTitle = false; $sawAuthor = false;
        $i = 0;
        for (; $i < count($paras); $i++) {
            $t = $paras[$i]['plain'];
            if (!$t) continue;
            if ($i === 0) continue;
            if (preg_match('/^balkan med j\b/i', $t)) continue;
            if (preg_match('/^DOI[:\s]/i', $t)) { $sawDoi = true; continue; }
            if (preg_match('/orcid\.org\//i', $t)) { $sawAuthor = true; continue; }
            if (preg_match('/^Corresponding\s+author/i', $t)) continue;
            if (preg_match('/^e-?mail\s*[:：]/i', $t)) continue;
            if (preg_match('/^(Received|Accepted|Yay[ıi]n|Published|Online)\s*[:：]/iu', $t)) continue;
            if (preg_match('/^abstract$/i', $t)) continue;
            if (preg_match('/^keywords?\s*[:：]/i', $t)) continue;
            if (preg_match('/^\d+\s*\S/', $t) && preg_match('/universit|üniversite|department|b[öo]l[üu]m|hospital|hastane|clinic|klinik|institut|enstit[üu]|faculty|fak[üu]lte|laborat|cent(er|re)|college|school|division|service|unit/iu', $t)) continue;
            if ($sawDoi && !$sawTitle && !$sawAuthor) { $sawTitle = true; continue; }
            break;
        }
        return $i;
    }

    private static function buildBodyHtml(array $paras, array $opts): array
    {
        $isOriginal = self::isOriginalType($opts['type'] ?? '');
        $idxAbstract = self::findIndexPlain($paras, fn($t) => (bool)preg_match('/^abstract$/i', $t));
        $idxKeywords = -1;
        for ($i = ($idxAbstract >= 0 ? $idxAbstract : 0); $i < count($paras); $i++) {
            if (preg_match('/^keywords?\s*:/i', $paras[$i]['plain'])) { $idxKeywords = $i; break; }
        }
        $start = -1;
        if ($idxKeywords >= 0) {
            $start = $idxKeywords + 1;
            $kwInline = (bool)preg_match('/^keywords?\s*:\s*\S/i', $paras[$idxKeywords]['plain']);
            if (!$kwInline && isset($paras[$start]) && !self::looksLikeHeading($paras[$start]) && self::looksLikeKeywordList($paras[$start]['plain'])) $start += 1;
        } else {
            $after = $idxAbstract >= 0 ? $idxAbstract : 0;
            for ($i = $after + 1; $i < count($paras); $i++) {
                if (self::looksLikeHeading($paras[$i])) { $start = $i; break; }
            }
            if ($start < 0) $start = self::firstNonMetadataIndex($paras);
        }
        while ($start < count($paras) && !(isset($paras[$start]) && ($paras[$start]['plain'] || trim($paras[$start]['html'] ?? '')))) $start++;
        if ($start < 0) $start = 0;

        $ctx = ['isOriginal' => $isOriginal, 'seenMain' => false];
        $html = ''; $headingCount = 0; $inRefs = false; $refHeading = 'References'; $refItems = [];
        for ($i = $start; $i < count($paras); $i++) {
            $p = $paras[$i];
            if (!$p['plain'] && !$p['html']) continue;
            if ($p['type'] === 'table') { $html .= $p['html'] . "\n"; continue; }
            if (!$inRefs && preg_match('/^(references|reference list|bibliography|kaynaklar|kaynakça|kaynakca)$/u', self::normalizeHeading($p['plain']))) {
                $inRefs = true;
                $rh = preg_replace('/^[\d.]+[).]?\s+/', '', $p['plain']);
                $rh = trim(preg_replace('/\s+/', ' ', $rh));
                $refHeading = $rh ?: 'References';
                continue;
            }
            if ($inRefs) {
                if ($p['html']) $refItems[] = preg_replace('/^\s*\d+[.)]\s+/', '', $p['html']);
                continue;
            }
            if (self::looksLikeHeading($p)) {
                $tag = self::classifyHeadingLevel($p, $ctx);
                if ($tag === 'h3') $ctx['seenMain'] = true;
                $headingCount++;
                $html .= "<$tag>" . self::esc($p['plain']) . "</$tag>\n";
                continue;
            }
            $html .= '<p>' . ($p['html'] ?: self::esc($p['plain'])) . "</p>\n";
        }
        if ($refItems) {
            $shown = ($refHeading === mb_strtoupper($refHeading, 'UTF-8')) ? 'References' : $refHeading;
            $html .= "\n<div class=\"article-references\">\n  <h3>" . self::esc($shown) . "</h3>\n  <ol>\n";
            foreach ($refItems as $r) $html .= "    <li>$r</li>\n";
            $html .= "  </ol>\n</div>\n";
        }
        return ['html' => trim($html), 'headingCount' => $headingCount];
    }

    private static function extractParagraphs(string $xml): array
    {
        $result = [];
        if (preg_match_all('/<w:p\b[^>]*>(.*?)<\/w:p>/s', $xml, $ps, PREG_SET_ORDER)) {
            foreach ($ps as $pm) {
                $inner = $pm[1];
                $text = ''; $hasSuper = false;
                if (preg_match_all('/<w:r\b[^>]*>(.*?)<\/w:r>/s', $inner, $rs, PREG_SET_ORDER)) {
                    foreach ($rs as $rm) {
                        $r = $rm[1];
                        if (preg_match('/<w:vertAlign\s+w:val="superscript"/', $r)) $hasSuper = true;
                        if (preg_match_all('/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/s', $r, $ts)) {
                            foreach ($ts[1] as $tv) $text .= self::decode($tv);
                        }
                        if (preg_match('/<w:tab\b/', $r)) $text .= "\t";
                        if (preg_match('/<w:br\b/', $r)) $text .= "\n";
                    }
                }
                $result[] = ['text' => trim($text), 'hasSuperscript' => $hasSuper];
            }
        }
        return $result;
    }

    private static function findIndexText(array $paras, callable $pred, int $from = 0): int
    {
        for ($i = $from; $i < count($paras); $i++) if ($pred($paras[$i]['text'], $i)) return $i;
        return -1;
    }
    private static function findIndexPlain(array $paras, callable $pred, int $from = 0): int
    {
        for ($i = $from; $i < count($paras); $i++) if ($pred($paras[$i]['plain'], $i)) return $i;
        return -1;
    }

    private static function findLabeledDate(array $paras, array $labelPatterns): string
    {
        for ($i = 0; $i < count($paras); $i++) {
            $text = trim((string)($paras[$i]['text'] ?? ''));
            if (!$text) continue;
            foreach ($labelPatterns as $label) {
                if (!preg_match('/(?:^|[;,|]|\s)\s*(?:' . $label . ')\s*(?:date|tarihi)?\s*[:：\-–—]?\s*([^;|]*)/iu', $text, $match)) continue;
                $inline = \Dates::parse($match[1]);
                if ($inline) return $inline;
                for ($next = $i + 1; $next < min(count($paras), $i + 3); $next++) {
                    $adj = \Dates::parse($paras[$next]['text'] ?? '');
                    if ($adj) return $adj;
                    if (trim((string)($paras[$next]['text'] ?? ''))) break;
                }
            }
        }
        return '';
    }

    private static function extractMetadata(array $paras): array
    {
        $meta = ['type' => '', 'doi' => '', 'title' => '', 'authors' => [], 'abstract' => '', 'keywords' => [],
                 'received' => '', 'accepted' => '', 'publishedOnline' => '', 'published' => '', 'correspondingEmail' => '', 'warnings' => []];

        $cursor = 0;
        while ($cursor < count($paras) && !$paras[$cursor]['text']) $cursor++;
        if ($cursor < count($paras) && !preg_match('/^DOI[:\s]/i', $paras[$cursor]['text'])) { $meta['type'] = $paras[$cursor]['text']; $cursor++; }

        $doiIdx = self::findIndexText(array_slice($paras, 0, 8), fn($t) => (bool)preg_match('/^DOI[:\s]/i', $t));
        if ($doiIdx >= 0) {
            if (preg_match('/^DOI[:\s]+(.+?)\s*$/i', $paras[$doiIdx]['text'], $m)) $meta['doi'] = trim($m[1]);
            $cursor = max($cursor, $doiIdx + 1);
        } else { $meta['warnings'][] = 'DOI satırı bulunamadı'; }

        while ($cursor < count($paras) && !$paras[$cursor]['text']) $cursor++;
        if ($cursor < count($paras) && !preg_match('/orcid\.org\//i', $paras[$cursor]['text'])) { $meta['title'] = $paras[$cursor]['text']; $cursor++; }
        else $meta['warnings'][] = 'Başlık satırı bulunamadı';

        $authorParas = [];
        while ($cursor < count($paras)) {
            $t = $paras[$cursor]['text'];
            if (!$t) { $cursor++; continue; }
            if (preg_match('/orcid\.org\//i', $t)) { $authorParas[] = $t; $cursor++; }
            else break;
        }
        foreach ($authorParas as $t) {
            if (!preg_match('/orcid\.org\/([\w-]+)\s+(.+?)\s*$/i', $t, $m)) {
                $meta['warnings'][] = 'Yazar satırı ayrıştırılamadı: ' . mb_substr($t, 0, 80);
                continue;
            }
            $orcid = $m[1];
            $rest = preg_replace('/[,.;]+\s*$/', '', $m[2]);
            $name = $rest; $affIdx = '';
            if (preg_match('/^(.*?)\s*((?:\d+\s*,?\s*)+)$/', $rest, $tail)) {
                $name = trim($tail[1]);
                $affIdx = rtrim(preg_replace('/\s+/', '', $tail[2]), ',');
            }
            $meta['authors'][] = ['name' => $name, 'orcid' => $orcid, '_affIdxRaw' => $affIdx];
        }
        if (!$meta['authors']) $meta['warnings'][] = 'Yazar satırı bulunamadı';

        $affiliations = [];
        while ($cursor < count($paras)) {
            $t = $paras[$cursor]['text'];
            if (!$t) { $cursor++; continue; }
            if (preg_match('/^(Corresponding\s+author|Received|Accepted|Abstract|e-?mail|Yayın|Published|Online)/iu', $t)) break;
            if (!preg_match('/^(\d+)\s*(.+)$/', $t, $m)) break;
            $affiliations[(int)$m[1]] = trim($m[2]);
            $cursor++;
        }
        if (!array_filter($affiliations)) $meta['warnings'][] = 'Kurum satırı bulunamadı';

        foreach ($meta['authors'] as &$a) {
            $idxs = array_filter(array_map('intval', explode(',', $a['_affIdxRaw'])), fn($n) => $n > 0);
            $texts = array_filter(array_map(fn($n) => $affiliations[$n] ?? null, $idxs));
            $a['affiliation'] = implode('; ', $texts);
            unset($a['_affIdxRaw']);
        }
        unset($a);

        for ($i = $cursor; $i < min(count($paras), $cursor + 6); $i++) {
            if (preg_match('/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i', $paras[$i]['text'], $em)) { $meta['correspondingEmail'] = $em[0]; break; }
        }

        $dateParas = array_slice($paras, 0, 80);
        $meta['received'] = self::findLabeledDate($dateParas, ['received', 'date\s+received', 'submission\s+date', 'alındığı', 'alindigi', 'alındı', 'alindi', 'geliş', 'gelis', 'başvuru', 'basvuru']);
        $meta['accepted'] = self::findLabeledDate($dateParas, ['accepted', 'acceptance', 'date\s+accepted', 'kabul', 'kabul\s+edildi']);
        $meta['publishedOnline'] = self::findLabeledDate($dateParas, ['published\s+online', 'online\s+publication', 'available\s+online', 'online\s+first', 'online', 'epub', 'e-pub', 'çevrimiçi\s+yayın', 'cevrimici\s+yayin']);
        $meta['published'] = self::findLabeledDate($dateParas, ['published(?!\s+online)', 'publication\s+date', 'date\s+published', 'yayın', 'yayin', 'yayım', 'yayim', 'yayımlanma', 'yayinlanma']);

        $absIdx = self::findIndexText($paras, fn($t) => (bool)preg_match('/^Abstract\s*$/i', $t));
        $kwIdx = self::findIndexText($paras, fn($t) => (bool)preg_match('/^Keywords?\s*:/i', $t), $absIdx >= 0 ? $absIdx : 0);
        if ($absIdx >= 0) {
            $stop = $kwIdx >= 0 ? $kwIdx : self::findIndexText($paras, fn($t) => self::isLikelyBodyHeading($t), $absIdx + 1);
            $end = $stop >= 0 ? $stop : count($paras);
            $parts = [];
            for ($i = $absIdx + 1; $i < $end; $i++) if ($paras[$i]['text']) $parts[] = $paras[$i]['text'];
            $meta['abstract'] = implode("\n\n", $parts);
        } elseif (self::typeHasAbstract($meta['type'])) {
            $meta['warnings'][] = '"Abstract" başlığı bulunamadı';
        }

        return $meta;
    }

    private static function isLikelyBodyHeading($text): bool
    {
        $t = trim((string)$text);
        if (!$t || mb_strlen($t) > 80) return false;
        if (!preg_match('/^[A-Z0-9\s.,&\-\/]+$/', $t)) return false;
        if (!preg_match('/[A-Z]/', $t)) return false;
        return true;
    }
}
