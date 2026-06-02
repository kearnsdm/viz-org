<?php
/**
 * viz-sync.php — tiny board-sync store for viz-org.
 *
 * Drop this file anywhere under your DreamHost web directory (it needs PHP,
 * which DreamHost shared hosting has). It stores your whole board as a single
 * JSON file next to itself, protected by a passphrase. Point the viz-org app's
 * "Sync URL" at this file's https:// address and use the same passphrase.
 *
 * SETUP: change $SECRET below to your own long, random passphrase, then enter
 * that same passphrase in the app.
 */

// ----------------------------------------------------------------------------
$SECRET = 'CHANGE-ME-to-a-long-random-passphrase';
// ----------------------------------------------------------------------------

$DATA_FILE = __DIR__ . '/viz-data.json';

// CORS — the app is served from a different origin (GitHub Pages). Auth is by
// the passphrase below, so allowing any origin is fine.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Viz-Key');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

// Read the passphrase from the header (preferred) or a ?key= query fallback.
$provided = '';
if (isset($_SERVER['HTTP_X_VIZ_KEY'])) {
  $provided = $_SERVER['HTTP_X_VIZ_KEY'];
} elseif (isset($_GET['key'])) {
  $provided = $_GET['key'];
}

if (!hash_equals($SECRET, $provided)) {
  http_response_code(401);
  echo json_encode(['error' => 'unauthorized']);
  exit;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  if (!file_exists($DATA_FILE)) {
    echo json_encode(['state' => null]);
    exit;
  }
  echo file_get_contents($DATA_FILE);
  exit;
}

if ($method === 'POST') {
  $body = file_get_contents('php://input');
  if (json_decode($body) === null) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid JSON']);
    exit;
  }
  if (file_put_contents($DATA_FILE, $body, LOCK_EX) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'could not write data file']);
    exit;
  }
  echo json_encode(['ok' => true, 'savedAt' => gmdate('c')]);
  exit;
}

http_response_code(405);
echo json_encode(['error' => 'method not allowed']);
