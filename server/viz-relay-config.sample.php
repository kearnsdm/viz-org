<?php
/**
 * viz-relay-config.sample.php
 *
 * Copy this to  viz-relay-config.php  (same folder) and fill in real values.
 * viz-relay-config.php is gitignored and must NEVER be committed.
 */

return [
  // A long random passphrase YOU invent. This is the low-stakes key callers
  // present (chat / Cowork / Code / the app). It guards this one task board
  // and nothing else. Rotate it freely.
  'relayKey'  => 'CHANGE-ME-to-a-long-random-relay-key',

  // ABSOLUTE path where the JSON documents live — put it OUTSIDE the web
  // root so the files are never directly reachable over HTTP. Created (0700)
  // on first request if missing; snapshots land in <dataDir>/snapshots.
  'dataDir'   => '/home/YOURUSER/viz-data',

  // OPTIONAL — only needed for the one-time ?action=migrate-from-gist pull
  // of the legacy gist backplane. Safe to delete both lines after migrating.
  'gistToken' => '',
  'gistId'    => '',
];
