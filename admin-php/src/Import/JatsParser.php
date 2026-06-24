<?php
namespace Import;

/**
 * JATS Archiving 1.3 XML -> article object. PHP/DOMDocument port of
 * admin/lib/jats-parser.js. Returns the same structured array the Node parser
 * produced (type/title/doi/authors/abstract/fullTextHtml/figures/...).
 */
class JatsParser
{
    private const TYPE_MAP = [
        'research-article' => 'Original Article',
        'brief-report' => 'Brief Report',
        'editorial' => 'Editorial',
        'correction' => 'Erratum',
        'letter' => 'Letter to the Editor',
        'review-article' => 'Invited Review',
        'case-report' => 'Case Report',
        'retraction' => 'Retraction Notice',
    ];

    private const MAX_DOCTYPE_BYTES = 204800;
    private const MAX_ENTITY_DECLS = 8;

    public static function parse(string $xml): array
    {
        self::guardXxe($xml);

        $doc = new \DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $ok = $doc->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$ok || !$doc->documentElement) {
            throw new \HttpError('Geçersiz XML', 400);
        }

        $article = $doc->documentElement;
        $front = self::child($article, 'front');
        $body = self::child($article, 'body');
        $back = self::child($article, 'back');
        $floats = self::child($article, 'floats-group');
        $response = self::child($article, 'response');

        $articleMeta = $front ? self::child($front, 'article-meta') : null;

        // Type
        $subjEl = self::deepFirst($articleMeta, ['article-categories', 'subj-group', 'subject']);
        $typeFromSubject = $subjEl ? self::stripTags(self::text($subjEl)) : '';
        $attrType = $article->getAttribute('article-type');
        $typeFromAttr = self::TYPE_MAP[$attrType] ?? $attrType;
        $type = $typeFromSubject ?: ($typeFromAttr ?: 'Original Article');

        // Title
        $titleEl = self::deepFirst($articleMeta, ['title-group', 'article-title']);
        $title = self::stripTags(self::text($titleEl));

        // DOI / PMID (article-id by pub-id-type)
        $doi = self::articleId($articleMeta, 'doi');
        $pmid = self::articleId($articleMeta, 'pmid');

        // Authors
        $contribGroup = $articleMeta ? self::child($articleMeta, 'contrib-group') : null;
        [$authors, $corresponding, $authorMeta] = self::parseAuthors($contribGroup);

        // Dates
        $history = $articleMeta ? self::child($articleMeta, 'history') : null;
        $received = self::historyDate($history, 'received');
        $accepted = self::historyDate($history, 'accepted');
        $published = self::pubDate($articleMeta);

        // Volume / issue / pages
        $volume = $articleMeta ? (int)self::text(self::child($articleMeta, 'volume')) : 0;
        $volume = $volume ?: null;
        $issue = $articleMeta ? self::text(self::child($articleMeta, 'issue')) : '';
        $fpage = $articleMeta ? self::text(self::child($articleMeta, 'fpage')) : '';
        $lpage = $articleMeta ? self::text(self::child($articleMeta, 'lpage')) : '';
        $elocationId = $articleMeta ? self::text(self::child($articleMeta, 'elocation-id')) : '';
        $pages = ($fpage && $lpage) ? "$fpage-$lpage" : ($fpage ?: ($elocationId ?: ''));

        // Abstract / keywords
        [$abstract, $abstractHtml] = self::parseAbstract($articleMeta ? self::child($articleMeta, 'abstract') : null);
        $keywords = self::parseKeywords($articleMeta);

        // Body, figures, tables, supplementary, funding, permissions, back matter
        $bodyHtml = self::bodyToHtml($body);
        $figures = self::parseFigures($floats);
        $tables = self::parseTables($floats);
        $supplementary = self::parseSupplementary($articleMeta, $body, $back, $floats);
        $funding = self::parseFunding($articleMeta);
        $permissions = self::parsePermissions($articleMeta);
        $backMatter = self::parseBackMatter($back);
        $fullTextHtml = self::buildFullText($bodyHtml, $figures, $tables, $backMatter, $supplementary, $funding);
        $relatedArticles = self::parseRelated($body, $articleMeta);

        $replyArticle = null;
        if ($response) {
            $replyArticle = [
                'title' => self::text(self::deepFirst($response, ['front-stub', 'title-group', 'article-title'])) ?: 'Reply',
                'bodyHtml' => self::bodyToHtml(self::child($response, 'body')),
                'backMatter' => self::parseBackMatter(self::child($response, 'back')),
            ];
        }

        $previewText = $abstract ? trim(preg_replace('/\s+/', ' ', mb_substr($abstract, 0, 360))) : '';

        return [
            'type' => $type, 'title' => $title, 'doi' => $doi, 'pmid' => $pmid,
            'authors' => $authors, 'abstract' => $abstract, 'abstractHtml' => $abstractHtml,
            'previewText' => $previewText, 'keywords' => $keywords,
            'received' => $received, 'accepted' => $accepted, 'published' => $published,
            'volume' => $volume, 'issue' => $issue, 'pages' => $pages, 'elocationId' => $elocationId,
            'fullTextHtml' => $fullTextHtml,
            'figures' => array_map(fn($f) => ['id' => $f['id'], 'label' => $f['label'], 'caption' => $f['caption'], 'imageFile' => $f['imageFile']], $figures),
            'supplementary' => $supplementary, 'funding' => $funding, 'permissions' => $permissions,
            'relatedArticles' => $relatedArticles, 'replyArticle' => $replyArticle,
            'authorMetadata' => array_merge([
                'correspondingName' => $corresponding['name'] ?? '',
                'correspondingAffiliation' => $corresponding['affiliation'] ?? '',
                'email' => $corresponding['email'] ?? '',
            ], $authorMeta),
        ];
    }

    // ---- DOM helpers --------------------------------------------------------
    private static function child(?\DOMNode $el, string $name): ?\DOMElement
    {
        if (!$el) return null;
        foreach ($el->childNodes as $c) {
            if ($c->nodeType === XML_ELEMENT_NODE && $c->nodeName === $name) return $c;
        }
        return null;
    }
    private static function childList(?\DOMNode $el, string $name): array
    {
        $out = [];
        if (!$el) return $out;
        foreach ($el->childNodes as $c) {
            if ($c->nodeType === XML_ELEMENT_NODE && $c->nodeName === $name) $out[] = $c;
        }
        return $out;
    }
    /** Walk a chain of single-child names. */
    private static function deepFirst(?\DOMNode $el, array $chain): ?\DOMElement
    {
        $cur = $el;
        foreach ($chain as $name) {
            $cur = self::child($cur, $name);
            if (!$cur) return null;
        }
        return $cur instanceof \DOMElement ? $cur : null;
    }
    private static function text(?\DOMNode $el): string
    {
        return $el ? trim($el->textContent) : '';
    }
    private static function stripTags(string $s): string { return trim(preg_replace('/<[^>]+>/', '', $s)); }
    private static function esc($s): string
    {
        return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], (string)$s);
    }

    private static function articleId(?\DOMElement $meta, string $type): string
    {
        if (!$meta) return '';
        foreach (self::childList($meta, 'article-id') as $el) {
            if ($el->getAttribute('pub-id-type') === $type) return self::text($el);
        }
        return '';
    }

    // ---- Authors ------------------------------------------------------------
    private static function parseAuthors(?\DOMElement $contribGroup): array
    {
        $authors = []; $corresponding = null; $orcidByName = [];
        if (!$contribGroup) return [$authors, $corresponding, ['orcidByName' => $orcidByName]];

        $affMap = [];
        foreach (self::childList($contribGroup, 'aff') as $aff) {
            $id = $aff->getAttribute('id');
            if (!$id) continue;
            $affText = self::text($aff);
            $label = self::child($aff, 'label');
            if ($label) {
                $labelText = self::text($label);
                if ($labelText !== '') $affText = trim(str_replace($labelText, '', $affText));
            }
            $affMap[$id] = $affText;
        }

        foreach (self::childList($contribGroup, 'contrib') as $contrib) {
            if ($contrib->getAttribute('contrib-type') !== 'author') continue;
            $nameEl = self::child($contrib, 'name');
            $surname = $nameEl ? self::text(self::child($nameEl, 'surname')) : '';
            $given = $nameEl ? self::text(self::child($nameEl, 'given-names')) : '';
            $fullName = trim("$given $surname");

            $orcid = '';
            foreach (self::childList($contrib, 'contrib-id') as $cid) {
                if ($cid->getAttribute('contrib-id-type') === 'orcid') { $orcid = self::text($cid); break; }
            }
            $affs = [];
            foreach (self::childList($contrib, 'xref') as $x) {
                if ($x->getAttribute('ref-type') === 'aff') {
                    $rid = $x->getAttribute('rid');
                    if (!empty($affMap[$rid])) $affs[] = $affMap[$rid];
                }
            }
            $affiliation = implode('; ', $affs);
            $email = self::text(self::child($contrib, 'email'));
            $authors[] = ['name' => $fullName, 'affiliation' => $affiliation, 'orcid' => $orcid];
            if ($orcid) $orcidByName[$fullName] = $orcid;
            if ($contrib->getAttribute('corresp') === 'yes') {
                $corresponding = ['name' => $fullName, 'affiliation' => $affiliation, 'email' => $email];
            }
        }
        return [$authors, $corresponding, ['orcidByName' => $orcidByName]];
    }

    // ---- Dates --------------------------------------------------------------
    private static function historyDate(?\DOMElement $history, string $type): string
    {
        if (!$history) return '';
        foreach (self::childList($history, 'date') as $d) {
            if ($d->getAttribute('date-type') === $type) return self::formatDate($d);
        }
        return '';
    }
    private static function pubDate(?\DOMElement $meta): string
    {
        if (!$meta) return '';
        $dates = self::childList($meta, 'pub-date');
        if (!$dates) return '';
        $chosen = null;
        foreach ($dates as $d) if ($d->getAttribute('date-type') === 'pub') { $chosen = $d; break; }
        return self::formatDate($chosen ?: $dates[0]);
    }
    private static function formatDate(?\DOMElement $d): string
    {
        if (!$d) return '';
        $year = self::text(self::child($d, 'year'));
        if (!$year) return '';
        $month = self::text(self::child($d, 'month')) ?: '01';
        $day = self::text(self::child($d, 'day')) ?: '01';
        return sprintf('%s-%s-%s', $year, str_pad($month, 2, '0', STR_PAD_LEFT), str_pad($day, 2, '0', STR_PAD_LEFT));
    }

    // ---- Abstract / keywords ------------------------------------------------
    private static function parseAbstract(?\DOMElement $abstractEl): array
    {
        if (!$abstractEl) return ['', ''];
        $secs = self::childList($abstractEl, 'sec');
        $structured = $abstractEl->getAttribute('abstract-type') === 'section' || $secs;
        if ($structured) {
            $plain = []; $html = [];
            foreach ($secs as $sec) {
                $secTitle = self::text(self::child($sec, 'title'));
                $paras = array_map([self::class, 'inline'], self::childList($sec, 'p'));
                $plainParas = array_map([self::class, 'text'], self::childList($sec, 'p'));
                if ($secTitle !== '') {
                    $html[] = "<strong>$secTitle:</strong> " . implode(' ', $paras);
                    $plain[] = "$secTitle: " . implode(' ', $plainParas);
                } else {
                    $html[] = implode(' ', $paras);
                    $plain[] = implode(' ', $plainParas);
                }
            }
            return [trim(implode(' ', $plain)), implode("\n", array_map(fn($h) => "<p>$h</p>", $html))];
        }
        $paras = self::childList($abstractEl, 'p');
        $plain = trim(implode(' ', array_map([self::class, 'text'], $paras)));
        $html = implode("\n", array_map(fn($p) => '<p>' . self::inline($p) . '</p>', $paras));
        return [$plain, $html];
    }
    private static function parseKeywords(?\DOMElement $meta): array
    {
        if (!$meta) return [];
        $groups = self::childList($meta, 'kwd-group');
        if (!$groups) return [];
        $chosen = null;
        foreach ($groups as $g) if ($g->getAttribute('xml:lang') === 'en') { $chosen = $g; break; }
        $chosen = $chosen ?: $groups[0];
        return array_map(fn($k) => self::stripTags(self::text($k)), self::childList($chosen, 'kwd'));
    }

    // ---- Inline / mixed content ---------------------------------------------
    private static function inline(?\DOMNode $el): string
    {
        if (!$el) return '';
        $map = ['italic' => 'em', 'bold' => 'strong', 'sup' => 'sup', 'sub' => 'sub'];
        $html = '';
        foreach ($el->childNodes as $child) {
            if ($child->nodeType === XML_TEXT_NODE || $child->nodeType === XML_CDATA_SECTION_NODE) {
                $html .= self::esc($child->nodeValue);
                continue;
            }
            if ($child->nodeType !== XML_ELEMENT_NODE) continue;
            $tag = $child->nodeName;
            if (isset($map[$tag])) {
                $html .= "<{$map[$tag]}>" . self::inline($child) . "</{$map[$tag]}>";
            } elseif ($tag === 'ext-link') {
                $href = $child->getAttribute('xlink:href') ?: '#';
                $html .= '<a href="' . self::esc($href) . '" target="_blank">' . self::inline($child) . '</a>';
            } elseif ($tag === 'xref') {
                $refType = $child->getAttribute('ref-type');
                if ($refType === 'bibr') $html .= '<sup>' . self::text($child) . '</sup>';
                elseif ($refType === 'fig' || $refType === 'table') $html .= '<a href="#' . $child->getAttribute('rid') . '">' . self::text($child) . '</a>';
                else $html .= self::text($child);
            } elseif ($tag === 'list') {
                $html .= self::listToHtml($child);
            } elseif ($tag === 'def-list') {
                $html .= self::defListToHtml($child);
            } else {
                $html .= self::inline($child);
            }
        }
        return $html;
    }

    private static function bodyToHtml(?\DOMElement $body): string
    {
        if (!$body) return '';
        $out = [];
        foreach (self::childList($body, 'sec') as $sec) $out[] = self::sectionToHtml($sec, 'h3');
        return implode("\n", $out);
    }
    private static function sectionToHtml(\DOMElement $sec, string $headingTag): string
    {
        if (self::isSupplementaryOnlySection($sec)) return '';
        $html = '';
        $title = self::text(self::child($sec, 'title'));
        if ($title !== '') $html .= "<$headingTag>" . self::esc($title) . "</$headingTag>\n";
        $next = $headingTag === 'h3' ? 'h4' : 'h5';
        foreach ($sec->childNodes as $child) {
            if ($child->nodeType !== XML_ELEMENT_NODE) continue;
            $tag = $child->nodeName;
            if ($tag === 'title') continue;
            elseif ($tag === 'p') $html .= '<p>' . self::inline($child) . "</p>\n";
            elseif ($tag === 'sec') $html .= self::sectionToHtml($child, $next);
            elseif ($tag === 'list') $html .= self::listToHtml($child) . "\n";
            elseif ($tag === 'def-list') $html .= self::defListToHtml($child) . "\n";
            elseif ($tag === 'table-wrap') $html .= self::tableWrapToHtml($child) . "\n";
        }
        return $html;
    }
    private static function isSupplementaryOnlySection(\DOMElement $sec): bool
    {
        $title = trim(self::text(self::child($sec, 'title')));
        if (!preg_match('/^supplementary materials?$/i', $title)) return false;
        foreach ($sec->childNodes as $child) {
            if ($child->nodeType === XML_TEXT_NODE || $child->nodeType === XML_CDATA_SECTION_NODE) {
                if (trim($child->nodeValue) !== '') return false;
                continue;
            }
            if ($child->nodeType !== XML_ELEMENT_NODE) continue;
            if ($child->nodeName !== 'title' && $child->nodeName !== 'supplementary-material') return false;
        }
        return true;
    }
    private static function listToHtml(\DOMElement $list): string
    {
        $tag = $list->getAttribute('list-type') === 'order' ? 'ol' : 'ul';
        $html = "<$tag>";
        foreach (self::childList($list, 'list-item') as $item) {
            $parts = array_map([self::class, 'inline'], self::childList($item, 'p'));
            $content = implode(' ', $parts);
            foreach (self::childList($item, 'list') as $nested) $content .= self::listToHtml($nested);
            $html .= "<li>$content</li>";
        }
        return $html . "</$tag>";
    }
    private static function defListToHtml(\DOMElement $dl): string
    {
        $html = '<dl>';
        foreach (self::childList($dl, 'def-item') as $item) {
            $term = self::inline(self::child($item, 'term'));
            $defEl = self::child($item, 'def');
            $defs = $defEl ? array_map([self::class, 'inline'], self::childList($defEl, 'p')) : [];
            $html .= "<dt>$term</dt><dd>" . implode(' ', $defs) . "</dd>";
        }
        return $html . '</dl>';
    }

    // ---- Figures / tables ---------------------------------------------------
    private static function parseFigures(?\DOMElement $floats): array
    {
        if (!$floats) return [];
        $out = [];
        foreach (self::childList($floats, 'fig') as $fig) {
            $caption = self::child($fig, 'caption');
            $capParts = $caption ? array_map([self::class, 'inline'], self::childList($caption, 'p')) : [];
            $graphic = self::child($fig, 'graphic');
            $out[] = [
                'id' => $fig->getAttribute('id'),
                'label' => self::text(self::child($fig, 'label')),
                'caption' => implode(' ', $capParts),
                'imageFile' => $graphic ? $graphic->getAttribute('xlink:href') : '',
            ];
        }
        return $out;
    }
    private static function parseTables(?\DOMElement $floats): array
    {
        if (!$floats) return [];
        $out = [];
        foreach (self::childList($floats, 'table-wrap') as $tw) {
            $tableEl = self::child($tw, 'table');
            $foot = self::child($tw, 'table-wrap-foot');
            $footParts = $foot ? array_map([self::class, 'inline'], self::childList($foot, 'p')) : [];
            $out[] = [
                'id' => $tw->getAttribute('id'),
                'label' => self::text(self::child($tw, 'label')),
                'tableHtml' => $tableEl ? self::tableToHtml($tableEl) : '',
                'footnote' => implode('<br>', $footParts),
            ];
        }
        return $out;
    }
    private static function tableWrapToHtml(\DOMElement $tw): string
    {
        $tableEl = self::child($tw, 'table');
        $tableHtml = $tableEl ? self::tableToHtml($tableEl) : '';
        if (!$tableHtml) return '';
        $id = $tw->getAttribute('id');
        $label = self::text(self::child($tw, 'label'));
        $foot = self::child($tw, 'table-wrap-foot');
        $footParts = $foot ? array_map([self::class, 'inline'], self::childList($foot, 'p')) : [];
        $footnote = implode('<br>', $footParts);
        $html = '<div' . ($id ? ' id="' . self::esc($id) . '"' : '') . ' class="article-table-wrap">';
        if ($label) $html .= '<p class="table-label"><strong>' . self::esc($label) . '</strong></p>';
        $html .= $tableHtml;
        if ($footnote) $html .= '<p class="table-footnote">' . $footnote . '</p>';
        return $html . '</div>';
    }
    private static function tableToHtml(\DOMElement $tableEl): string
    {
        $html = '<table class="article-table">';
        foreach (['thead', 'tbody', 'tfoot'] as $section) {
            $sectionEl = self::child($tableEl, $section);
            if (!$sectionEl) continue;
            $html .= "<$section>";
            foreach (self::childList($sectionEl, 'tr') as $tr) {
                $html .= '<tr>';
                foreach (['th', 'td'] as $cellTag) {
                    foreach (self::childList($tr, $cellTag) as $cell) {
                        $attrs = '';
                        $colspan = $cell->getAttribute('colspan');
                        $rowspan = $cell->getAttribute('rowspan');
                        if ($colspan && $colspan !== '1') $attrs .= " colspan=\"$colspan\"";
                        if ($rowspan && $rowspan !== '1') $attrs .= " rowspan=\"$rowspan\"";
                        $ps = self::childList($cell, 'p');
                        $content = $ps ? implode(' ', array_map([self::class, 'inline'], $ps)) : self::inline($cell);
                        $html .= "<$cellTag$attrs>$content</$cellTag>";
                    }
                }
                $html .= '</tr>';
            }
            $html .= "</$section>";
        }
        return $html . '</table>';
    }

    // ---- Supplementary / funding / permissions / back ----------------------
    private static function parseSupplementary(?\DOMElement $meta, ?\DOMElement $body, ?\DOMElement $back, ?\DOMElement $floats): array
    {
        $out = [];
        $sources = array_merge(
            $meta ? self::childList($meta, 'supplementary-material') : [],
            $body ? self::bodySupplementaryMaterials($body) : [],
            $back ? self::childList($back, 'supplementary-material') : [],
            $floats ? self::childList($floats, 'supplementary-material') : []
        );
        foreach ($sources as $sm) {
            $caption = self::child($sm, 'caption');
            $capParts = $caption ? array_map([self::class, 'text'], self::childList($caption, 'p')) : [];
            $media = self::child($sm, 'media') ?: self::child($sm, 'inline-supplementary-material');
            $href = $media ? $media->getAttribute('xlink:href') : '';
            if (!$href) $href = $sm->getAttribute('xlink:href');
            if (!$href) $href = self::firstExtLinkHref($sm);
            $mime = $media ? ($media->getAttribute('mime-subtype') ?: $media->getAttribute('mimetype')) : '';
            $out[] = [
                'id' => $sm->getAttribute('id'), 'label' => self::text(self::child($sm, 'label')),
                'caption' => implode(' ', $capParts), 'href' => $href, 'mimeType' => $mime,
            ];
        }
        return $out;
    }
    private static function bodySupplementaryMaterials(\DOMElement $body): array
    {
        $out = [];
        $walk = function (\DOMElement $sec) use (&$out, &$walk) {
            foreach (self::childList($sec, 'supplementary-material') as $sm) $out[] = $sm;
            foreach (self::childList($sec, 'sec') as $childSec) $walk($childSec);
        };
        foreach (self::childList($body, 'sec') as $sec) $walk($sec);
        return $out;
    }
    private static function firstExtLinkHref(\DOMNode $node): string
    {
        if ($node->nodeType === XML_ELEMENT_NODE && $node->nodeName === 'ext-link') {
            $href = $node->attributes?->getNamedItem('xlink:href')?->nodeValue ?? '';
            if ($href) return $href;
        }
        foreach ($node->childNodes as $child) {
            $href = self::firstExtLinkHref($child);
            if ($href) return $href;
        }
        return '';
    }
    private static function parseFunding(?\DOMElement $meta): array
    {
        if (!$meta) return [];
        $fg = self::child($meta, 'funding-group');
        if (!$fg) return [];
        $out = [];
        foreach (self::childList($fg, 'award-group') as $ag) {
            $out[] = [
                'source' => self::text(self::child($ag, 'funding-source')),
                'awardIds' => array_map([self::class, 'text'], self::childList($ag, 'award-id')),
            ];
        }
        return $out;
    }
    private static function parsePermissions(?\DOMElement $meta): ?array
    {
        if (!$meta) return null;
        $perm = self::child($meta, 'permissions');
        if (!$perm) return null;
        $license = self::child($perm, 'license');
        $licText = '';
        if ($license) {
            $lp = self::childList($license, 'license-p') ?: self::childList($license, 'p');
            $licText = implode(' ', array_map([self::class, 'text'], $lp));
        }
        return [
            'copyrightStatement' => self::text(self::child($perm, 'copyright-statement')),
            'copyrightYear' => self::text(self::child($perm, 'copyright-year')),
            'copyrightHolder' => self::text(self::child($perm, 'copyright-holder')),
            'licenseType' => $license ? $license->getAttribute('license-type') : '',
            'licenseUrl' => $license ? $license->getAttribute('xlink:href') : '',
            'licenseText' => $licText,
        ];
    }
    private static function parseBackMatter(?\DOMElement $back): array
    {
        $result = ['footnotes' => [], 'references' => [], 'acknowledgments' => ''];
        if (!$back) return $result;
        $ack = self::child($back, 'ack');
        if ($ack) $result['acknowledgments'] = implode("\n", array_map([self::class, 'inline'], self::childList($ack, 'p')));
        foreach (self::childList($back, 'fn-group') as $fg) {
            foreach (self::childList($fg, 'fn') as $fn) {
                $result['footnotes'][] = [
                    'type' => $fn->getAttribute('fn-type'),
                    'html' => implode(' ', array_map([self::class, 'inline'], self::childList($fn, 'p'))),
                ];
            }
        }
        $refList = self::child($back, 'ref-list');
        if ($refList) {
            foreach (self::childList($refList, 'ref') as $ref) {
                $citation = self::child($ref, 'element-citation') ?: self::child($ref, 'mixed-citation');
                if ($citation) {
                    $result['references'][] = ['label' => self::text(self::child($ref, 'label')), 'html' => self::formatCitation($citation)];
                }
            }
        }
        return $result;
    }
    private static function formatCitation(\DOMElement $citation): string
    {
        $pg = self::child($citation, 'person-group');
        $names = [];
        if ($pg) {
            foreach (self::childList($pg, 'name') as $n) {
                $names[] = self::text(self::child($n, 'surname')) . ' ' . self::text(self::child($n, 'given-names'));
            }
        }
        $authorStr = implode(', ', $names);
        if ($pg && self::child($pg, 'etal')) $authorStr .= ', et al';
        $html = self::esc($authorStr) . '. ' . self::esc(self::text(self::child($citation, 'article-title'))) . '. ';
        $source = self::text(self::child($citation, 'source'));
        if ($source) $html .= '<em>' . self::esc($source) . '</em>. ';
        $year = self::text(self::child($citation, 'year'));
        $volume = self::text(self::child($citation, 'volume'));
        $fpage = self::text(self::child($citation, 'fpage'));
        $lpage = self::text(self::child($citation, 'lpage'));
        if ($year) $html .= $year;
        if ($volume) $html .= ";$volume";
        if ($fpage) $html .= ":$fpage";
        if ($lpage) $html .= "-$lpage";
        $html .= '.';
        $doi = '';
        foreach (self::childList($citation, 'pub-id') as $pi) if ($pi->getAttribute('pub-id-type') === 'doi') { $doi = self::text($pi); break; }
        if ($doi) $html .= " doi:$doi";
        return $html;
    }

    private static function parseRelated(?\DOMElement $body, ?\DOMElement $meta): array
    {
        $related = [];
        $map = ['corrected-article' => 'erratum-for', 'retracted-article' => 'retraction-of', 'commentary-article' => 'comment-on', 'companion' => 'related-to'];
        $collect = function (\DOMElement $ra) use (&$related, $map) {
            $relType = $ra->getAttribute('related-article-type');
            $related[] = [
                'type' => $map[$relType] ?? 'related-to', 'targetDoi' => '',
                'targetPmid' => $ra->getAttribute('xlink:href'),
                'targetVolume' => (int)$ra->getAttribute('vol') ?: null,
                'targetPages' => $ra->getAttribute('page'), 'label' => self::text($ra),
            ];
        };
        if ($body) foreach ($body->getElementsByTagName('related-article') as $ra) $collect($ra);
        if ($meta) foreach (self::childList($meta, 'related-article') as $ra) $collect($ra);
        return $related;
    }

    private static function buildFullText(string $bodyHtml, array $figures, array $tables, array $backMatter, array $supplementary, array $funding): string
    {
        $html = $bodyHtml;
        foreach ($figures as $fig) {
            $html .= "\n<figure id=\"{$fig['id']}\" class=\"article-figure\">\n";
            $html .= '  <figcaption><strong>' . self::esc($fig['label']) . "</strong></figcaption>\n";
            if ($fig['imageFile']) $html .= '  <img src="' . self::esc($fig['imageFile']) . '" alt="' . self::esc($fig['label']) . "\" loading=\"lazy\">\n";
            if ($fig['caption']) $html .= "  <p>{$fig['caption']}</p>\n";
            $html .= "</figure>\n";
        }
        foreach ($tables as $tbl) {
            $html .= "\n<div id=\"{$tbl['id']}\" class=\"article-table-wrap\">\n";
            $html .= '  <p class="table-label"><strong>' . self::esc($tbl['label']) . "</strong></p>\n";
            $html .= "  {$tbl['tableHtml']}\n";
            if ($tbl['footnote']) $html .= "  <p class=\"table-footnote\">{$tbl['footnote']}</p>\n";
            $html .= "</div>\n";
        }
        if (!empty($backMatter['acknowledgments']) || !empty($backMatter['footnotes']) || $funding) {
            $html .= "\n<div class=\"article-backmatter-notes\">\n";
            if (!empty($backMatter['acknowledgments'])) {
                foreach (explode("\n", $backMatter['acknowledgments']) as $part) if (trim($part)) $html .= "  <p><strong>Acknowledgments:</strong> $part</p>\n";
            }
            foreach ($backMatter['footnotes'] as $fn) $html .= "  <p>{$fn['html']}</p>\n";
            if ($funding) {
                foreach ($funding as $f) {
                    $ids = $f['awardIds'] ? ' (' . self::esc(implode(', ', $f['awardIds'])) . ')' : '';
                    $html .= '  <p><strong>Funding:</strong> ' . self::esc($f['source']) . "$ids</p>\n";
                }
            }
            $html .= "</div>\n";
        }
        if (false && (!empty($backMatter['footnotes']) || $supplementary)) {
            $html .= "\n<div class=\"article-notes-box\">\n";
            foreach ($backMatter['footnotes'] as $fn) $html .= "  <p>{$fn['html']}</p>\n";
            foreach ($supplementary as $sm) {
                $id = !empty($sm['id']) ? ' id="' . self::esc($sm['id']) . '"' : '';
                $label = !empty($sm['label']) ? self::esc($sm['label']) : 'Supplementary Material:';
                $href = !empty($sm['href']) ? self::esc($sm['href']) : '';
                $caption = !empty($sm['caption']) ? self::esc($sm['caption']) : '';
                $html .= "  <p$id data-supplementary-note=\"true\"><strong>$label</strong>";
                if ($href) $html .= " <a href=\"$href\" target=\"_blank\" rel=\"noopener\">" . ($caption ?: $href) . "</a>";
                elseif ($caption) $html .= " $caption";
                $html .= "</p>\n";
            }
            $html .= "</div>\n";
            $supplementary = [];
            $backMatter['footnotes'] = [];
        }
        if ($supplementary) {
            $html .= "\n<div class=\"article-supplementary\">\n  <h3>Supplementary Materials</h3>\n";
            foreach ($supplementary as $sm) {
                $label = $sm['label'] ? self::esc($sm['label']) : 'Supplementary Material';
                $caption = $sm['caption'] ? ' — ' . self::esc($sm['caption']) : '';
                if ($sm['href']) $html .= '    <p data-supplementary-note="true"><strong>' . $label . '</strong> <a href="' . self::esc($sm['href']) . '" target="_blank" rel="noopener">' . ($caption ?: self::esc($sm['href'])) . "</a></p>\n";
                else $html .= "    <p data-supplementary-note=\"true\"><strong>$label</strong>$caption</p>\n";
            }
            $html .= "</div>\n";
        }
        if (false && $backMatter['footnotes']) {
            $html .= "\n<div class=\"article-footnotes\">\n";
            foreach ($backMatter['footnotes'] as $fn) $html .= "  <p>{$fn['html']}</p>\n";
            $html .= "</div>\n";
        }
        if ($backMatter['references']) {
            $html .= "\n<div class=\"article-references\">\n  <h3>References</h3>\n  <ol>\n";
            foreach ($backMatter['references'] as $ref) $html .= "    <li>{$ref['html']}</li>\n";
            $html .= "  </ol>\n</div>\n";
        }
        return $html;
    }

    // ---- XXE guard ----------------------------------------------------------
    private static function guardXxe(string $xml): void
    {
        $head = ltrim(preg_replace('/^\xEF\xBB\xBF/', '', substr($xml, 0, 8192)));
        if (!preg_match('/<!DOCTYPE\b/i', $head)) return;
        $start = preg_match('/<!DOCTYPE\b/i', $xml, $m, PREG_OFFSET_CAPTURE) ? $m[0][1] : -1;
        if ($start < 0) return;
        $subsetStart = strpos($xml, '[', $start);
        $subsetEnd = $subsetStart !== false ? strpos($xml, ']>', $subsetStart) : false;
        if ($subsetEnd !== false && ($subsetEnd - $subsetStart) > self::MAX_DOCTYPE_BYTES) {
            throw new \HttpError('XML DOCTYPE block too large — refusing to parse', 400);
        }
        $subset = $subsetStart !== false ? substr($xml, $subsetStart, ($subsetEnd !== false ? $subsetEnd - $subsetStart : null)) : '';
        if (preg_match_all('/<!ENTITY\b/i', $subset) > self::MAX_ENTITY_DECLS) {
            throw new \HttpError('XML contains too many entity declarations — refusing to parse', 400);
        }
        if (preg_match('/<!ENTITY[^>]*\b(SYSTEM|PUBLIC)\b/i', $subset)) {
            throw new \HttpError('XML declares an external entity — refusing to parse', 400);
        }
    }
}
