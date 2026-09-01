//  Several calls in one asking.
//
//  A run is dozens of operations, and sent one per request each paid a full
//  round trip and held a connection for it; the requests themselves became the
//  load. This loops the same implementation the single endpoint and the watch
//  use, so the spending rules exist exactly once.
//
//  If one call aborts, everything before it keeps: requests are not
//  transactions (measured, not assumed), so completed calls hold their op rows
//  and their cache writes, and the caller re-asks only what is left, which the
//  cache then answers without spending.
query ops verb=POST {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    int run_id
    json calls
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org

    precondition (($input.calls|count) <= 8) {
      error_type = "badrequest"
      error = "At most eight calls in one asking."
    }

    var $answers {
      value = []
    }

    foreach ($input.calls) {
      each as $call {
        function.run "Relokit/execute_op" {
          input = {
            org_id        : $org.id
            run_id        : $input.run_id
            op_id         : $call|get:"op_id":""
            capability_id : $call|get:"capability_id":""
            endpoint      : $call|get:"endpoint":""
            params        : $call|get:"params":{}
            constraint_ids: $call|get:"constraint_ids":[]
            entity_ids    : $call|get:"entity_ids":[]
            ttl_seconds   : $call|get:"ttl_seconds":86400
          }
        } as $done

        var $answers {
          value = $answers|push:$done
        }
      }
    }
  }

  response = {answers: $answers}
  guid = "OpsBatch4kQ9mVr2tXw7LcJnPeA"
}
