<?php
/**
 * Minimal HTTP router. Patterns use ":name" for path params, matched against a
 * single non-slash segment. Handlers receive an assoc array of captured params.
 */
class Router
{
    /** @var array<int,array{method:string,regex:string,keys:string[],handler:callable}> */
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $keys = [];
        $regex = preg_replace_callback('#:([a-zA-Z_]\w*)#', function ($m) use (&$keys) {
            $keys[] = $m[1];
            return '([^/]+)';
        }, $pattern);
        $this->routes[] = [
            'method'  => strtoupper($method),
            'regex'   => '#^' . $regex . '/?$#',
            'keys'    => $keys,
            'handler' => $handler,
        ];
    }

    public function get(string $p, callable $h): void    { $this->add('GET', $p, $h); }
    public function post(string $p, callable $h): void   { $this->add('POST', $p, $h); }
    public function put(string $p, callable $h): void    { $this->add('PUT', $p, $h); }
    public function delete(string $p, callable $h): void { $this->add('DELETE', $p, $h); }

    /** Dispatch; returns false if no route matched (caller sends 404). */
    public function dispatch(string $method, string $path): bool
    {
        $method = strtoupper($method);
        foreach ($this->routes as $r) {
            if ($r['method'] !== $method) continue;
            if (!preg_match($r['regex'], $path, $m)) continue;
            $params = [];
            foreach ($r['keys'] as $i => $key) {
                $params[$key] = urldecode($m[$i + 1]);
            }
            ($r['handler'])($params);
            return true;
        }
        return false;
    }
}
