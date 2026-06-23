<?php
namespace Repo;

/** Editorial board + extended bios. Singletons exported to js/data/*.js. */
class Editorial
{
    public static function handleGetBoard(): void    { \Http::json(Store::get('editorial_board', new \stdClass())); }
    public static function handleGetExtended(): void { \Http::json(Store::get('editorial_extended', [])); }

    public static function handlePutBoard(): void
    {
        \Backup::snapshot();
        $data = \Http::body();
        Store::put('editorial_board', $data);
        \Site::writeEditorialBoard($data);
        \Http::json(['saved' => true]);
    }

    public static function handlePutExtended(): void
    {
        \Backup::snapshot();
        $data = \Http::body();
        Store::put('editorial_extended', $data);
        \Site::writeEditorialExtended($data);
        \Http::json(['saved' => true]);
    }
}
