//  Work handed over to wait its turn.
//
//  One request carries a whole stage's calls; nothing executes here. Short
//  polls do the work afterwards, so no connection is ever held open while a
//  third party thinks.
query jobs verb=POST {
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

    precondition (($input.calls|count) <= 40) {
      error_type = "badrequest"
      error = "At most forty calls in one handover."
    }

    var $ids {
      value = []
    }

    foreach ($input.calls) {
      each as $call {
        db.add relokit_job {
          data = {
            created_at: "now"
            org_id    : $org.id
            run_id    : $input.run_id
            status    : "pending"
            attempts  : 0
            call      : $call
          }
        } as $job

        var $ids {
          value = $ids|push:$job.id
        }
      }
    }
  }

  response = {job_ids: $ids}
  guid = "JobsEnq5xT8wRk3mYpQvLcHn2aB"
}
