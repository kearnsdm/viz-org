<?php
/**
 * viz-relay.php v2 — viz-org's sync backplane, hosted on YOUR server.
 *
 * v2 changes the architecture: the JSON files LIVE HERE, on this host's disk,
 * not in a GitHub gist. That removes GitHub's small shared gist-write budget
 * (100/hr — the thing that silently ate cross-machine edits), removes the
 * expiring PAT from the app entirely, and makes real concurrency control
 * possible (gists could only do blind whole-file replace).
 *
 * Callers present the low-stakes RELAY KEY. If it leaks, the blast radius is
 * "someone can read/write this one task board" — rotate it freely. This file
 * is safe to commit; secrets live in viz-relay-config.php (gitignored).
 *
 * Actions (auth: X-Viz-Key header preferred, or ?key= query param):
 *   GET  ?action=ping          -> {ok:true, store:"local"} — connection test
 *   GET  ?action=board|streams|reinforcement|analysis|inbox|chat
 *        -> the file's JSON (or a sensible empty default), with the current
 *           revision in the X-Viz-Rev response header
 *   POST ?action=board|streams|reinforcement|analysis|inbox|chat
 *        -> whole-file replace with the posted JSON body (stored VERBATIM
 *           after validation — PHP re-encoding would corrupt {} to []).
 *           OPTIMISTIC CONCURRENCY: send X-Viz-Rev-Base with the revision you
 *           pulled. If the file moved on, you get 409 {error:"stale", rev:N}
 *           — re-pull, merge, retry. Omit the header to force (legacy/chat).
 *   POST ?action=append        -> body {candidates:[CandidateTask,...]};
 *                                 merges into the inbox, deduped by id
 *   POST ?action=chat-post     -> body {from:"board"|"claude", text, taskId?,
 *                                 taskTitle?, replyTo?}; the relay assigns id +
 *                                 timestamp and appends to the chat document
 *                                 (callers never read-modify-write this file)
 *   POST ?action=migrate-from-gist
 *        -> one-time cutover: pulls all five files from the configured gist
 *           into local storage. Refuses if a board already exists here
 *           (add ?force=1 to overwrite). After this, the gist is a frozen
 *           archive and nothing here touches GitHub again.
 *
 * Storage: config 'dataDir' (recommended: OUTSIDE the web root, e.g.
 * /home/<user>/viz-data). Writes are flock-guarded and atomic (tmp+rename);
 * every write bumps the file's revision; rotating snapshots (every ≥6h per
 * file, pruned after 21 days) replace the gist's version history.
 *
 * SETUP is documented at the bottom of this file and in server/README.md.
 */

declare(strict_types=1);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Viz-Key, X-Viz-Rev-Base');
header('Access-Control-Expose-Headers: X-Viz-Rev');
header('X-Content-Type-Options: nosniff');
// Sync state must NEVER be cached: the host's default mod_expires policy
// otherwise stamps responses cacheable for days, which feeds devices stale
// boards and stale revision numbers (= endless CAS conflicts).
header('Cache-Control: no-store, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

// --- load config (relay key + storage dir; gist token only for migration) ---
$cfgPath = __DIR__ . '/viz-relay-config.php';
if (!is_file($cfgPath)) {
  http_response_code(500);
  echo json_encode(['error' => 'relay not configured']);
  exit;
}
/** @var array{relayKey:string,gistToken?:string,gistId?:string,dataDir?:string} $CFG */
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

// --- storage layout ----------------------------------------------------------
$DATA_DIR = (isset($CFG['dataDir']) && is_string($CFG['dataDir']) && $CFG['dataDir'] !== '')
  ? rtrim($CFG['dataDir'], '/')
  : __DIR__ . '/viz-data';
$SNAP_DIR = $DATA_DIR . '/snapshots';
foreach ([$DATA_DIR, $SNAP_DIR] as $d) {
  if (!is_dir($d) && !@mkdir($d, 0700, true)) {
    http_response_code(500);
    echo json_encode(['error' => 'storage dir unavailable']);
    exit;
  }
}
// If the data dir ended up inside a web root, refuse to serve its files.
$ht = $DATA_DIR . '/.htaccess';
if (!is_file($ht)) @file_put_contents($ht, "Require all denied\n");

// --- light rate limit: fixed 60s window, flock-guarded ---------------------
$RATE_MAX = 120;
$RATE_WINDOW = 60;
$rlPath = $DATA_DIR . '/rate.json';
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
    header('Retry-After: 30');
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

// --- the document store -------------------------------------------------------
// One JSON file per document + a sidecar .rev integer. All mutation happens
// under an exclusive flock on the doc's .lock file; content lands via
// tmp+rename so a crash can never leave a half-written file.

const DOCS = [
  'board'         => 'viz-org-board.json',
  'streams'       => 'viz-org-streams.json',
  'reinforcement' => 'viz-org-reinforcement.json',
  'analysis'      => 'viz-org-analysis.json',
  'inbox'         => 'viz-org-inbox.json',
  'chat'          => 'viz-org-chat.json',
];

/** Empty-store defaults, matching what the app/chat expect from day one. */
const DOC_DEFAULTS = [
  'board'         => '{"state":null}',
  'streams'       => '{"v":3,"streams":[]}',
  'reinforcement' => '{"v":1,"kind":"viz-org-reinforcement"}',
  'analysis'      => '{"v":1,"kind":"viz-org-analysis"}',
  'inbox'         => '[]',
  'chat'          => '{"v":1,"kind":"viz-org-chat","messages":[]}',
];

/** Chat lane bounds: oldest messages are trimmed past the cap. */
const CHAT_MAX_MESSAGES = 500;
const CHAT_MAX_TEXT_BYTES = 8000;

/** Snapshot cadence + retention. */
const SNAP_MIN_INTERVAL = 6 * 3600;
const SNAP_KEEP_SECONDS = 21 * 24 * 3600;

function docPaths(string $doc): array {
  global $DATA_DIR;
  $file = DOCS[$doc];
  return [
    'data' => "$DATA_DIR/$file",
    'rev'  => "$DATA_DIR/$file.rev",
    'lock' => "$DATA_DIR/$file.lock",
  ];
}

function docLock(string $doc) {
  $p = docPaths($doc);
  $h = fopen($p['lock'], 'c');
  if ($h === false) return null;
  flock($h, LOCK_EX);
  return $h;
}

function docUnlock($h): void {
  if ($h) {
    flock($h, LOCK_UN);
    fclose($h);
  }
}

/** @return array{content: ?string, rev: int} */
function docRead(string $doc): array {
  $p = docPaths($doc);
  $content = is_file($p['data']) ? file_get_contents($p['data']) : null;
  $rev = is_file($p['rev']) ? (int) trim((string) file_get_contents($p['rev'])) : 0;
  return ['content' => $content === false ? null : $content, 'rev' => $rev];
}

function snapshotMaybe(string $doc, string $content): void {
  global $SNAP_DIR;
  $file = DOCS[$doc];
  $latest = 0;
  foreach (glob("$SNAP_DIR/$file.*.json") ?: [] as $s) {
    $latest = max($latest, (int) filemtime($s));
  }
  $now = time();
  if ($now - $latest < SNAP_MIN_INTERVAL) return;
  @file_put_contents("$SNAP_DIR/$file." . date('Ymd-His', $now) . '.json', $content);
  foreach (glob("$SNAP_DIR/$file.*.json") ?: [] as $s) {
    if ($now - (int) filemtime($s) > SNAP_KEEP_SECONDS) @unlink($s);
  }
}

/**
 * Write a document. $baseRev null = unconditional (legacy/chat callers);
 * otherwise the write only lands if the stored revision still equals it.
 * @return array{ok: bool, stale?: bool, rev: int}
 */
function docWrite(string $doc, string $content, ?int $baseRev): array {
  $p = docPaths($doc);
  $h = docLock($doc);
  if ($h === null) return ['ok' => false, 'rev' => 0];
  $cur = docRead($doc);
  if ($baseRev !== null && $baseRev !== $cur['rev']) {
    docUnlock($h);
    return ['ok' => false, 'stale' => true, 'rev' => $cur['rev']];
  }
  $tmp = $p['data'] . '.tmp';
  $ok = @file_put_contents($tmp, $content) !== false && @rename($tmp, $p['data']);
  if (!$ok) {
    @unlink($tmp);
    docUnlock($h);
    return ['ok' => false, 'rev' => $cur['rev']];
  }
  $newRev = $cur['rev'] + 1;
  @file_put_contents($p['rev'], (string) $newRev);
  snapshotMaybe($doc, $content);
  docUnlock($h);
  return ['ok' => true, 'rev' => $newRev];
}

// --- request helpers -----------------------------------------------------------

function readJsonBody(int $maxBytes = 1048576): ?array {
  $raw = file_get_contents('php://input');
  if ($raw === false || strlen($raw) > $maxBytes) return null;
  $j = json_decode($raw, true);
  return is_array($j) ? $j : null;
}

/** Validate the body parses as JSON, return it RAW to store verbatim. */
function readRawJsonBody(int $maxBytes = 1048576): ?string {
  $raw = file_get_contents('php://input');
  if ($raw === false || $raw === '' || strlen($raw) > $maxBytes) return null;
  json_decode($raw);
  return json_last_error() === JSON_ERROR_NONE ? $raw : null;
}

function baseRevHeader(): ?int {
  $v = $_SERVER['HTTP_X_VIZ_REV_BASE'] ?? null;
  if ($v === null || $v === '' || $v === '*') return null;
  return ctype_digit((string) $v) ? (int) $v : null;
}

// Keep multibyte text readable where the relay itself re-encodes (inbox merge).
const RELAY_JSON = JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE;

// --- gist client (MIGRATION ONLY — nothing else touches GitHub in v2) ----------

function gh(string $method, string $path, array $cfg, ?string $body = null): array {
  $ch = curl_init("https://api.github.com$path");
  $headers = [
    'Authorization: Bearer ' . ($cfg['gistToken'] ?? ''),
    'Accept: application/vnd.github+json',
    'X-GitHub-Api-Version: 2022-11-28',
    'User-Agent: viz-relay',
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

// --- dispatch --------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_GET['action'] ?? '');

if ($method === 'GET' && $action === 'ping') {
  $revs = [];
  foreach (array_keys(DOCS) as $doc) $revs[$doc] = docRead($doc)['rev'];
  echo json_encode(['ok' => true, 'store' => 'local', 'revs' => $revs]);
  exit;
}

// GET any document.
if ($method === 'GET' && isset(DOCS[$action])) {
  $r = docRead($action);
  header('X-Viz-Rev: ' . $r['rev']);
  echo ($r['content'] !== null && trim($r['content']) !== '') ? $r['content'] : DOC_DEFAULTS[$action];
  exit;
}

// POST whole-file replace for any document, with optional CAS.
if ($method === 'POST' && isset(DOCS[$action])) {
  $raw = readRawJsonBody();
  if ($raw === null) { http_response_code(400); echo json_encode(['error' => 'invalid or oversized JSON']); exit; }
  $w = docWrite($action, $raw, baseRevHeader());
  if (!empty($w['stale'])) {
    http_response_code(409);
    header('X-Viz-Rev: ' . $w['rev']);
    echo json_encode(['error' => 'stale', 'rev' => $w['rev']]);
    exit;
  }
  if (!$w['ok']) { http_response_code(500); echo json_encode(['error' => 'write failed']); exit; }
  header('X-Viz-Rev: ' . $w['rev']);
  echo json_encode(['ok' => true, 'rev' => $w['rev']]);
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

  // Read-merge-write under the inbox lock so concurrent appends can't race.
  $h = docLock('inbox');
  $cur = docRead('inbox');
  $existing = $cur['content'] ? json_decode($cur['content'], true) : [];
  if (!is_array($existing)) $existing = [];
  $byId = [];
  foreach ($existing as $e) {
    if (is_array($e) && isset($e['id']) && is_string($e['id'])) $byId[$e['id']] = $e;
  }
  foreach ($valid as $c) { $byId[$c['id']] = $c; }
  $merged = array_values($byId);
  docUnlock($h); // docWrite re-locks; the pre-merge lock only shrank the race window
  $w = docWrite('inbox', (string) json_encode($merged, RELAY_JSON), null);
  http_response_code($w['ok'] ? 200 : 500);
  if ($w['ok']) header('X-Viz-Rev: ' . $w['rev']);
  echo json_encode($w['ok']
    ? ['ok' => true, 'added' => count($valid), 'inbox' => count($merged), 'rev' => $w['rev']]
    : ['error' => 'write failed']);
  exit;
}

// POST ?action=chat-post — append ONE message to the chat document.
// Both the board and Claude sessions call this; the relay assigns the id and
// timestamp, so callers never read-modify-write the file and cannot race
// each other. Consumers poll ?action=ping and re-fetch chat when its rev moves.
if ($method === 'POST' && $action === 'chat-post') {
  $j = readJsonBody();
  $from = is_array($j) ? ($j['from'] ?? null) : null;
  $text = is_array($j) ? ($j['text'] ?? null) : null;
  if (!in_array($from, ['board', 'claude'], true)) {
    http_response_code(400);
    echo json_encode(['error' => "expected from: 'board' or 'claude'"]);
    exit;
  }
  if (!is_string($text) || trim($text) === '' || strlen($text) > CHAT_MAX_TEXT_BYTES) {
    http_response_code(400);
    echo json_encode(['error' => 'text must be a non-empty string of at most ' . CHAT_MAX_TEXT_BYTES . ' bytes']);
    exit;
  }
  $msg = [
    'id'   => 'm' . base_convert((string) (int) (microtime(true) * 1000), 10, 36) . bin2hex(random_bytes(2)),
    'at'   => gmdate('Y-m-d\TH:i:s\Z'),
    'from' => $from,
    'text' => $text,
  ];
  foreach (['taskId', 'taskTitle', 'replyTo'] as $k) {
    if (isset($j[$k]) && is_string($j[$k]) && $j[$k] !== '') $msg[$k] = $j[$k];
  }

  $h = docLock('chat');
  $cur = docRead('chat');
  $doc = $cur['content'] !== null ? json_decode($cur['content'], true) : null;
  if (!is_array($doc) || !isset($doc['messages']) || !is_array($doc['messages'])) {
    $doc = ['v' => 1, 'kind' => 'viz-org-chat', 'messages' => []];
  }
  $doc['messages'][] = $msg;
  if (count($doc['messages']) > CHAT_MAX_MESSAGES) {
    $doc['messages'] = array_slice($doc['messages'], -CHAT_MAX_MESSAGES);
  }
  docUnlock($h); // docWrite re-locks; the pre-merge lock only shrank the race window
  $w = docWrite('chat', (string) json_encode($doc, RELAY_JSON), null);
  http_response_code($w['ok'] ? 200 : 500);
  if ($w['ok']) header('X-Viz-Rev: ' . $w['rev']);
  echo json_encode($w['ok']
    ? ['ok' => true, 'message' => $msg, 'rev' => $w['rev']]
    : ['error' => 'write failed']);
  exit;
}

// One-time cutover from the gist. Idempotent: refuses when a board already
// exists locally unless ?force=1.
if ($method === 'POST' && $action === 'migrate-from-gist') {
  if (empty($CFG['gistToken']) || empty($CFG['gistId'])) {
    http_response_code(400);
    echo json_encode(['error' => 'gistToken/gistId not configured — nothing to migrate from']);
    exit;
  }
  $existing = docRead('board');
  if ($existing['content'] !== null && trim($existing['content']) !== '' && ($_GET['force'] ?? '') !== '1') {
    http_response_code(409);
    echo json_encode(['error' => 'store already has data; pass force=1 to overwrite', 'boardRev' => $existing['rev']]);
    exit;
  }
  $report = [];
  foreach (DOCS as $doc => $file) {
    $content = readGistFile($CFG, (string) $CFG['gistId'], $file);
    if ($content === null || trim($content) === '') {
      $report[$doc] = ['migrated' => false, 'reason' => 'absent or empty in gist'];
      continue;
    }
    $w = docWrite($doc, $content, null);
    $report[$doc] = $w['ok']
      ? ['migrated' => true, 'bytes' => strlen($content), 'rev' => $w['rev']]
      : ['migrated' => false, 'reason' => 'local write failed'];
  }
  echo json_encode(['ok' => true, 'report' => $report]);
  exit;
}

http_response_code(404);
echo json_encode(['error' => 'unknown action']);

/*
 * SETUP (DreamHost or any PHP host)
 * ---------------------------------
 * 1. Copy viz-relay-config.sample.php -> viz-relay-config.php and fill in:
 *      - relayKey  : a long random passphrase you invent (the low-stakes key)
 *      - dataDir   : ABSOLUTE path OUTSIDE the web root for the JSON store,
 *                    e.g. /home/youruser/viz-data (created automatically)
 *      - gistToken + gistId : only needed for the one-time migration; can be
 *                    deleted from the config afterwards
 *    viz-relay-config.php is gitignored — never commit it.
 * 2. Upload viz-relay.php (and the config) under your web directory,
 *    e.g. https://example.com/viz/viz-relay.php
 * 3. Migrate the existing gist data (once):
 *      curl -s -X POST -H "X-Viz-Key: <relayKey>" \
 *        "https://.../viz-relay.php?action=migrate-from-gist"
 * 4. Point the app at it: Backup / Sync -> paste the relay key. The app pulls
 *    and pushes through this endpoint from then on; GitHub is out of the loop.
 * 5. Snapshots land in <dataDir>/snapshots (6h cadence, 21-day retention).
 */
