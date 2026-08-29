//  The guard every Relokit endpoint runs first.
// 
//  Omitting auth on a Xano endpoint produces a public one and nothing marks it as
//  deliberate, so the check lives in one place that every endpoint calls rather
//  than being repeated until it is eventually missed. Here that matters more than
//  usual: an open endpoint is not a data leak, it is somebody else spending the
//  month's search quota.
// 
//  The emptiness check is not padding. A single equality against an unset token
//  compares empty to empty, which passes an anonymous caller while refusing a
//  real one, so the backend would be open exactly when nobody had configured it.
function "Relokit/require_org" {
  input {
  }

  stack {
    precondition ($env.$request_auth_token != null) {
      error_type = "unauthorized"
      error = "Relokit needs an org key."
    }
  
    // The table holds a digest, never the key, so a copy of the table is not a
    // set of working credentials.
    var $presented {
      value = $env.$request_auth_token|hash_sha256
    }
  
    db.query relokit_org {
      where = $db.relokit_org.api_key_hash == $presented
      return = {type: "single"}
    } as $org
  
    precondition ($org != null) {
      error_type = "unauthorized"
      error = "Unknown org key."
    }
  }

  response = $org
  guid = "WKXcPszyGP8DRlI-AnDFHwuscU4"
}