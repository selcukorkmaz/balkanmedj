<?php
namespace Repo;

/** Dashboard statistics. */
class Stats
{
    public static function handleStats(): void
    {
        $articles = Articles::all();
        $aip = ArticlesInPress::all();
        $archive = ArchiveIssues::read();
        $news = News::all();

        $typeCounts = [];
        foreach ($articles as $a) {
            $t = $a['type'] ?? null;
            $typeCounts[$t] = ($typeCounts[$t] ?? 0) + 1;
        }
        $totalIssues = 0;
        foreach ($archive as $y) $totalIssues += count($y['issues'] ?? []);

        \Http::json([
            'articleCount' => count($articles),
            'articlesInPressCount' => count($aip),
            'issueCount' => $totalIssues,
            'newsCount' => count($news),
            'typeCounts' => (object)$typeCounts,
            'yearRange' => $archive
                ? ['from' => $archive[count($archive) - 1]['year'], 'to' => $archive[0]['year']]
                : null,
        ]);
    }

    public static function handleTopArticles(): void
    {
        $limit = min(max((int)($_GET['limit'] ?? 20), 1), 100);
        $articles = Articles::all();
        $pick = fn($a) => [
            'id' => $a['id'] ?? null, 'title' => $a['title'] ?? null, 'type' => $a['type'] ?? null,
            'doi' => $a['doi'] ?? null, 'volume' => $a['volume'] ?? null, 'issue' => $a['issue'] ?? null,
            'views' => (int)($a['views'] ?? 0), 'downloads' => (int)($a['downloads'] ?? 0), 'citations' => (int)($a['citations'] ?? 0),
        ];
        $top = function (string $key) use ($articles, $limit, $pick) {
            $sorted = $articles;
            usort($sorted, fn($a, $b) => (int)($b[$key] ?? 0) <=> (int)($a[$key] ?? 0));
            return array_map($pick, array_slice($sorted, 0, $limit));
        };
        $sum = fn($key) => array_sum(array_map(fn($a) => (int)($a[$key] ?? 0), $articles));
        \Http::json([
            'topViewed' => $top('views'),
            'topDownloaded' => $top('downloads'),
            'topCited' => $top('citations'),
            'totals' => ['views' => $sum('views'), 'downloads' => $sum('downloads'), 'citations' => $sum('citations'), 'articles' => count($articles)],
        ]);
    }
}
