<?php
/**
 * Tiny request/response helpers shared by the front controller and routes.
 */
class Http
{
    /** Decoded JSON request body (for application/json requests). */
    public static function body(): array
    {
        static $cached = null;
        if ($cached !== null) return $cached;
        $raw = file_get_contents('php://input');
        if ($raw === '' || $raw === false) return $cached = [];
        $data = json_decode($raw, true);
        return $cached = (is_array($data) ? $data : []);
    }

    /** Send a JSON response and stop. */
    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /** Send a JSON error and stop. */
    public static function error(string $message, int $status = 400): void
    {
        self::json(['error' => $message], $status);
    }

    /** Client IP, honouring a single trusted proxy (parity with trust proxy 1). */
    public static function ip(): string
    {
        $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if ($fwd !== '') {
            $parts = explode(',', $fwd);
            return trim($parts[0]);
        }
        return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    }
}

/**
 * Thrown by route handlers to return a specific HTTP status with a message.
 * The front controller turns it into a JSON error.
 */
class HttpError extends RuntimeException
{
    public int $status;
    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}
