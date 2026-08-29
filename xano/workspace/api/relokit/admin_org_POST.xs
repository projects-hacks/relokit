// Creates an org and hands back its key once.
//
// Bootstrap only: require_org needs an org to exist before anything else can be
// called, so this one endpoint is guarded by an instance level admin key from
// the environment rather than by an org key.
//
// The key is returned here and nowhere else. The table keeps only a digest, so
// a copy of it is not a set of working credentials and a lost key is reissued
// rather than recovered.
query "admin/org" verb=POST {
  api_group = "Relokit"

  input {
    text name filters=trim
  }

  stack {
    precondition ($env.relokit_admin_key != null) {
      error_type = "unauthorized"
      error = "Relokit has no admin key configured on this instance."
    }

    precondition ($env.$request_auth_token == $env.relokit_admin_key) {
      error_type = "unauthorized"
      error = "Admin key missing or wrong."
    }

    security.create_uuid as $api_key

    db.add relokit_org {
      data = {
        created_at            : "now"
        name                  : $input.name
        api_key_hash          : ($api_key|hash_sha256)
        monthly_cost_units_cap: 5000
      }
    } as $org
  }

  response = {org_id: $org.id, name: $org.name, api_key: $api_key}
  guid = "kNnUIIki_vUXoxpMVVlCbQ9Nw_E"
}
