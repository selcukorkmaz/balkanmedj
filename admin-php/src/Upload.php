<?php
/**
 * Multipart upload helper — PHP $_FILES equivalent of the Node multer setup
 * (admin/server.js makeUploader). Validates by extension + size and moves the
 * temp file to its destination.
 */
class Upload
{
    /** Allowed filename extensions per upload kind (mirrors ALLOWED_EXT). */
    private const EXT = [
        'pdf'           => '/\.pdf$/i',
        'image'         => '/\.(jpe?g|png|webp|gif|svg)$/i',
        'video'         => '/\.(mp4|webm|ogv|mov)$/i',
        'xml'           => '/\.xml$/i',
        'zip'           => '/\.zip$/i',
        'figure'        => '/\.(jpe?g|png|webp|gif|svg|tiff?|pdf)$/i',
        'supplementary' => '/\.(pdf|zip|jpe?g|png|webp|gif|svg|mp4|mov|webm|mp3|wav|ogg|csv|txt|docx?|xlsx?)$/i',
        'docx'          => '/\.docx$/i',
        'document'      => '/\.(pdf|docx?|csv|xlsx?|pptx?)$/i',
    ];

    public static function sanitize(string $name): string
    {
        $base = basename($name);
        return preg_replace('/[^a-zA-Z0-9._-]/', '_', $base);
    }

    private static function checkExt(string $kind, string $originalName): void
    {
        $re = self::EXT[$kind] ?? null;
        if (!$re || !preg_match($re, $originalName)) {
            throw new HttpError("Desteklenmeyen dosya türü: {$originalName}", 400);
        }
    }

    /**
     * Return a single uploaded file: ['tmp'=>..., 'name'=>orig, 'size'=>int].
     * Throws HttpError(400) if missing/invalid. $kind enables ext validation.
     */
    public static function single(string $field, ?string $kind = null): array
    {
        if (empty($_FILES[$field]) || !is_uploaded_file($_FILES[$field]['tmp_name'] ?? '')) {
            throw new HttpError('No file', 400);
        }
        $f = $_FILES[$field];
        if (is_array($f['name'])) { // a single value was expected
            throw new HttpError('Expected a single file', 400);
        }
        if ($f['error'] !== UPLOAD_ERR_OK) throw new HttpError('Yükleme hatası (' . $f['error'] . ')', 400);
        if ($kind) self::checkExt($kind, $f['name']);
        return ['tmp' => $f['tmp_name'], 'name' => $f['name'], 'size' => (int)$f['size']];
    }

    /**
     * Return a list of uploaded files for a `field[]`-style multi upload.
     * Each: ['tmp'=>..., 'name'=>orig, 'size'=>int]. Skips errored entries.
     */
    public static function many(string $field, ?string $kind = null): array
    {
        if (empty($_FILES[$field])) return [];
        $f = $_FILES[$field];
        $out = [];
        if (is_array($f['name'])) {
            $n = count($f['name']);
            for ($i = 0; $i < $n; $i++) {
                if (($f['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                if (!is_uploaded_file($f['tmp_name'][$i])) continue;
                if ($kind) self::checkExt($kind, $f['name'][$i]);
                $out[] = ['tmp' => $f['tmp_name'][$i], 'name' => $f['name'][$i], 'size' => (int)$f['size'][$i]];
            }
        } else { // single file sent under the same field
            if ($f['error'] === UPLOAD_ERR_OK && is_uploaded_file($f['tmp_name'])) {
                if ($kind) self::checkExt($kind, $f['name']);
                $out[] = ['tmp' => $f['tmp_name'], 'name' => $f['name'], 'size' => (int)$f['size']];
            }
        }
        return $out;
    }

    /** Move an uploaded temp file to $dest (mkdir -p), cross-device safe. */
    public static function moveTo(string $tmp, string $dest): void
    {
        $dir = dirname($dest);
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        if (is_file($dest)) @unlink($dest);
        if (!@move_uploaded_file($tmp, $dest)) {
            if (!@rename($tmp, $dest)) {
                if (!@copy($tmp, $dest)) throw new HttpError('Dosya taşınamadı', 500);
                @unlink($tmp);
            }
        }
    }
}
