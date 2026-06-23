<?php
namespace Repo;

/**
 * Archive issues tree (year -> volume -> issues[]). Stored in the
 * `archive_issues` singleton; exported to js/data/archive-issues.js.
 */
class ArchiveIssues
{
    public static function read(): array
    {
        $d = Store::get('archive_issues', []);
        return is_array($d) ? $d : [];
    }

    public static function write(array $archive): void
    {
        Store::put('archive_issues', array_values($archive));
        \Site::writeArchiveIssues(array_values($archive));
    }

    /** Returns ['yearIndex'=>i,'issueIndex'=>j] for (volume,issue) or null. */
    public static function findIssue(array &$archive, $volume, $issue): ?array
    {
        $vol = (int)$volume; $iss = (string)$issue;
        foreach ($archive as $yi => $y) {
            foreach (($y['issues'] ?? []) as $ii => $i) {
                if ((int)($i['volume'] ?? 0) === $vol && (string)($i['issue'] ?? '') === $iss) {
                    return ['yearIndex' => $yi, 'issueIndex' => $ii];
                }
            }
        }
        return null;
    }

    public static function updateArticleCount(array &$archive, $volume, $issue, int $count): void
    {
        $loc = self::findIssue($archive, $volume, $issue);
        if ($loc) {
            $archive[$loc['yearIndex']]['issues'][$loc['issueIndex']]['articleCount'] = $count;
            $archive[$loc['yearIndex']]['issues'][$loc['issueIndex']]['hasLocalData'] = true;
        }
    }
}
