<?php
/**
 * viz-relay-config.sample.php
 *
 * Copy this to  viz-relay-config.php  (same folder) and fill in real values.
 * viz-relay-config.php is gitignored and must NEVER be committed.
 * Best practice: place the real config OUTSIDE the web root and point
 * $cfgPath in viz-relay.php at it.
 */

return [
  // A long random passphrase YOU invent. This is the low-stakes key callers
  // present (chat / Cowork / Code). It can only trigger the relay's narrow
  // actions — it is NOT your GitHub token. Rotate it freely.
  'relayKey'  => 'CHANGE-ME-to-a-long-random-relay-key',

  // Your GitHub classic personal-access token with the "gist" scope.
  // Lives ONLY here, server-side. Never returned by the relay, never logged.
  'gistToken' => 'ghp_REPLACE_WITH_YOUR_GIST_PAT',

  // Optional. If left blank, the relay discovers the gist holding
  // viz-org-board.json on first call. Set it to skip that lookup.
  'gistId'    => '',
];
