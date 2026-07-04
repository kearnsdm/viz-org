<?php
/**
 * viz-relay.php — secret-free task relay for viz-org.
 *
 * Lets Claude (chat / Cowork / Code) push tasks into your viz-org gist and read
 * board + checklist-stream state WITHOUT ever handling your GitHub token. The
 * powerful gist PAT lives only in viz-relay-config.php on this server. Callers
 * present a separate, low-stakes RELAY KEY that can do nothing but the narrow
 * actions below — if it leaks, the blast radius is "someone could drop tasks in
 * your inbox," not "someone owns your GitHub."
 *
 * This file is safe to commit (the repo is public): it contains no secrets.
 * The token lives in viz-relay-config.php, which is gitignored.
 *
 * Actions (all require the relay key via the X-Viz-Key header, preferred, or
 * a ?key= query param — the header keeps the key out of server access logs):
 *   GET  ?action=board     -> current board JSON ({v,state,savedAt}) or {state:null}
 *   GET  ?action=streams   -> current checklist streams JSON or {v:3,streams:[]}
 *   POST ?action=streams   -> replace streams file with the posted JSON body
 *   POST ?action=append    -> body {candidates:[CandidateTask,...]}; merges into
 *                             the inbox drop box, deduped by id
 *
 * SETUP is documented at the bottom of this file and in server/README.md.
 */

declare(strict_types=1);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Viz-Key');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

// --- load config (token + relay key live here, NOT in the public repo) -----
$cfgPath = __DIR__ . '/viz-relay-config.php';
if (!is_file($cfgPath)) {
  http_response_code(500);
  echo json_encode(['error' => 'relay not configured']);
  exit;
}
/** @var array{relayKey:string,gistToken:string,gistId?:string} $CFG */
$CFG = require $cfgPath;

// --- auth: constant-time check of the relay key ----------------------------
$provided = $_SERVER['HTTP_X_VIZ_KEY'] ?? ($_GET['key'] ?? '');
if (
  !is_array($CFG) || empty($CFG['relayKey']) || !is_string($CFG['relayKey']) ||
  !hash_equals($CFG['relayKey'], (string) $provided)
) {
  http_response_code(401);
  echo json_encode(['error' => 'unauthorized']);
  exit;
}

// --- light rate limit: fixed 60s window, flock-guarded ---------------------
$RATE_MAX = 60;
$RATE_WINDOW = 60;
$rlPath = __DIR__ . '/viz-relay-rate.json';
$now = time();
$fp = @fopen($rlPath, 'c+');
if ($fp) {
  flock($fp, LOCK_EX);
  $raw = stream_get_contents($fp);
  $hits = json_decode($raw ?: '[]', true);
  if (!is_array($hits)) $hits = [];
  $hits = array_values(array_filter($hits, static fn($t) => is_int($t) && $t > $now - $RATE_WINDOW));
  if (count($hits) >= $RATE_MAX) {
    flock($fp, LOCK_UN);
    fclose($fp);
    http_response_code(429);
    echo json_encode(['error' => 'rate limited']);
    exit;
  }
  $hits[] = $now;
  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, json_encode($hits));
  flock($fp, LOCK_UN);
  fclose($fp);
}

// --- GitHub gist API helper -------------------------------------------------
function gh(string $method, string $path, array $cfg, ?string $body = null): array {
  $ch = curl_init("https://api.github.com$path");
  $headers = [
    'Authorization: Bearer ' . $cfg['gistToken'],
    'Accept: application/vnd.github+json',
    'X-GitHub-Api-Version: 2022-11-28',
    'User-Agent: viz-relay', // GitHub requires a User-Agent
  ];
  if ($body !== null) $headers[] = 'Content-Type: application/json';
  curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_TIMEOUT        => 20,
  ]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
  $resp = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($resp === false) return ['status' => 502, 'json' => null];
  return ['status' => $status, 'json' => json_decode((string) $resp, true)];
}

function resolveGistId(array $cfg): ?string {
  if (!empty($cfg['gistId']) && is_string($cfg['gistId'])) return $cfg['gistId'];
  $r = gh('GET', '/gists?per_page=100', $cfg);
  if ($r['status'] !== 200 || !is_array($r['json'])) return null;
  foreach ($r['json'] as $g) {
    if (isset($g['files']['viz-org-board.json'])) return (string) $g['id'];
  }
  return null;
}

function readGistFile(array $cfg, string $id, string $file): ?string {
  $r = gh('GET', "/gists/$id", $cfg);
  if ($r['status'] !== 200 || !is_array($r['json'])) return null;
  $f = $r['json']['files'][$file] ?? null;
  if (!is_array($f)) return null;
  $content = (string) ($f['content'] ?? '');
  if (!empty($f['truncated']) && !empty($f['raw_url'])) {
    $raw = @file_get_contents($f['raw_url']);
    if ($raw !== false) $content = $raw;
  }
  return $content;
}

function writeGistFile(array $cfg, string $id, string $file, string $content): bool {
  $body = json_encode(['files' => [$file => ['content' => $content]]]);
  $r = gh('PATCH', "/gists/$id", $cfg, (string) $body);
  return $r['status'] === 200;
}

function readJsonBody(int $maxBytes = 262144): ?array {
  $raw = file_get_contents('php://input');
  if ($raw === false || strlen($raw) > $maxBytes) return null;
  $j = json_decode($raw, true);
  return is_array($j) ? $j : null;
}

// --- dispatch ---------------------------------------------------------------
$BOARD = 'viz-org-board.json';
$INBOX = 'viz-org-inbox.json';
$STREAMS = 'viz-org-streams.json';
$ANALYSIS = 'viz-org-analysis.json';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_GET['action'] ?? '');

$id = resolveGistId($CFG);
if ($id === null) {
  http_response_code(502);
  echo json_encode(['error' => 'could not locate gist']);
  exit;
}

if ($method === 'GET' && $action === 'board') {
  $c = readGistFile($CFG, $id, $BOARD);
  echo ($c !== null && trim($c) !== '') ? $c : json_encode(['state' => null]);
  exit;
}

if ($method === 'GET' && $action === 'streams') {
  $c = readGistFile($CFG, $id, $STREAMS);
  echo ($c !== null && trim($c) !== '') ? $c : json_encode(['v' => 3, 'streams' => []]);
  exit;
}

if ($method === 'POST' && $action === 'streams') {
  $j = readJsonBody();
  if ($j === null) { http_response_code(400); echo json_encode(['error' => 'invalid or oversized JSON']); exit; }
  $ok = writeGistFile($CFG, $id, $STREAMS, (string) json_encode($j, JSON_PRETTY_PRINT));
  http_response_code($ok ? 200 : 502);
  echo json_encode($ok ? ['ok' => true] : ['error' => 'upstream write failed']);
  exit;
}

if ($method === 'GET' && $action === 'analysis') {
  $c = readGistFile($CFG, $id, $ANALYSIS);
  echo ($c !== null && trim($c) !== '') ? $c : json_encode(['v' => 1, 'kind' => 'viz-org-analysis']);
  exit;
}

if ($method === 'POST' && $action === 'analysis') {
  $j = readJsonBody();
  if ($j === null) { http_response_code(400); echo json_encode(['error' => 'invalid or oversized JSON']); exit; }
  $ok = writeGistFile($CFG, $id, $ANALYSIS, (string) json_encode($j, JSON_PRETTY_PRINT));
  http_response_code($ok ? 200 : 502);
  echo json_encode($ok ? ['ok' => true] : ['error' => 'upstream write failed']);
  exit;
}

if ($method === 'POST' && $action === 'append') {
  $j = readJsonBody();
  $cands = is_array($j) ? ($j['candidates'] ?? null) : null;
  if (!is_array($cands)) { http_response_code(400); echo json_encode(['error' => 'expected {candidates:[...]}']); exit; }
  if (count($cands) > 200) { http_response_code(413); echo json_encode(['error' => 'too many candidates']); exit; }

  $allowedUrgency = ['low', 'normal', 'high', 'urgent'];
  $valid = [];
  foreach ($cands as $c) {
    if (!is_array($c)) continue;
    if (empty($c['id']) || !is_string($c['id'])) continue;
    if (empty($c['title']) || !is_string($c['title'])) continue;
    $c['from'] = (isset($c['from']) && is_string($c['from'])) ? $c['from'] : '';
    $c['urgency'] = in_array(($c['urgency'] ?? ''), $allowedUrgency, true) ? $c['urgency'] : 'normal';
    $valid[] = $c;
  }
  if (!$valid) { http_response_code(400); echo json_encode(['error' => 'no valid candidates']); exit; }

  // merge into the existing inbox, deduped by id (app does final dedupe too)
  $existingRaw = readGistFile($CFG, $id, $INBOX);
  $existing = $existingRaw ? json_decode($existingRaw, true) : [];
  if (!is_array($existing)) $existing = [];
  $byId = [];
  foreach ($existing as $e) {
    if (is_array($e) && isset($e['id']) && is_string($e['id'])) $byId[$e['id']] = $e;
  }
  foreach ($valid as $c) { $byId[$c['id']] = $c; }
  $merged = array_values($byId);

  $ok = writeGistFile($CFG, $id, $INBOX, (string) json_encode($merged, JSON_PRETTY_PRINT));
  http_response_code($ok ? 200 : 502);
  echo json_encode($ok
    ? ['ok' => true, 'added' => count($valid), 'inbox' => count($merged)]
    : ['error' => 'upstream write failed']);
  exit;
}

http_response_code(404);
echo json_encode(['error' => 'unknown action']);

/*
 * SETUP (DreamHost or any PHP host)
 * ---------------------------------
 * 1. Copy viz-relay-config.sample.php -> viz-relay-config.php and fill in:
 *      - relayKey  : a long random passphrase you invent (the low-stakes key)
 *      - gistToken : your GitHub classic PAT with the "gist" scope
 *      - gistId    : optional; auto-discovered if blank
 *    viz-relay-config.php is gitignored — never commit it. Even better, move it
 *    outside the web root and update the $cfgPath above.
 * 2. Upload viz-relay.php (and viz-relay-config.php) under your web directory,
 *    e.g. https://devinkearns.com/viz/viz-relay.php
 * 3. Confirm it serves over HTTPS. Test:
 *      curl -s -H "X-Viz-Key: <relayKey>" "https://.../viz-relay.php?action=board"
 * 4. Give the relay URL + relayKey (the low-stakes key, not the PAT) to whatever
 *    surface is pushing tasks. The URL is not secret and can live in CLAUDE.md.
 */
