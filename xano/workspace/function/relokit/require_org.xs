//  The guard every Relokit endpoint runs first.
// 
//  Omitting auth on a Xano endpoint produces a public one and nothing marks it as
//  deliberate, so the check lives in one place that every endpoint calls rather
//  than being repeated until it is eventually missed. Here that matters more than
//  usual: an open endpoint is not a data leak, it is somebody else spending the
//  month's search quota.
// 
//  The key arrives as an input rather than in an Authorization header.
//  $request_auth_token is not a general header reader: it is Xano's own token
//  format, and it tries to decode whatever it is given. A six character string
//  comes back as six characters, a twenty character one comes back as nothing at
//  all, and a sixty four character key arrives one character short. An input is
//  plain, and over HTTPS a body is no more exposed than a header.
// 
//  The emptiness check before the comparison is load bearing. A single equality
//  against an unset key compares empty to empty, which passes an anonymous caller
//  and refuses a real one, so the backend would be open exactly when nobody had
//  configured it.
function "Relokit/require_org" {
  input {
    text org_key filters=trim
  }

  stack {
    precondition ($input.org_key != null) {
      error_type = "unauthorized"
      error = "Relokit needs an org key."
    }
  
    //  The table holds a digest, never the key, so a copy of it is not a set of
    //  working credentials.
    // 
    //  Bare sha256, not sha256:true. The filter reference says the true argument
    //  gives hex; it gives raw bytes, which Postgres refuses with CHARACTER NOT
    //  IN REPERTOIRE. Bare and :false both give hex, and it matches what Node
    //  produces for the same input, which is what lets the seeder and this agree.
    var $presented {
      value = $input.org_key|sha256
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