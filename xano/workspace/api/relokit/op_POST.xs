//   The way a person asks for a call to be made.
// 
//   Thin on purpose. The work is in Relokit/execute_op, which the watch task
//   calls too, so a question asked now and the same question asked again at three
//   in the morning are answered by one implementation.
query op verb=POST {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    int run_id
    text op_id filters=trim
    text capability_id filters=trim
    text endpoint filters=trim
  
    // Already resolved. The caller binds the refs; this does not interpret them.
    json params
  
    json constraint_ids
  
    // Who this op answers for. Empty for a region wide call that belongs to no
    // listing in particular.
    json entity_ids
  
    int ttl_seconds?=86400
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org
  
    function.run "Relokit/execute_op" {
      input = {
        org_id        : $org.id
        run_id        : $input.run_id
        op_id         : $input.op_id
        capability_id : $input.capability_id
        endpoint      : $input.endpoint
        params        : $input.params
        constraint_ids: $input.constraint_ids
        entity_ids    : $input.entity_ids
        ttl_seconds   : $input.ttl_seconds
      }
    } as $done
  }

  response = $done
  guid = "ZgMw-_8CzcWY6xGkKMsuni-SRgY"
}