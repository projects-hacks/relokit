//  One short turn of the crank.
//
//  Takes a few waiting jobs and executes them; the caller keeps polling until
//  nothing is pending. attempts is written before anything runs, and writes
//  survive an abort (measured), so a job that kills its poll is still counted
//  against and passed over after two strikes rather than looping forever.
query "jobs/run" verb=POST {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    int run_id
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org

    db.query relokit_job {
      where = $db.relokit_job.run_id == $input.run_id && $db.relokit_job.org_id == $org.id && $db.relokit_job.status == "pending" && $db.relokit_job.attempts < 2
      return = {type: "list", paging: {page: 1, per_page: 4}}
    } as $page

    // A paged query answers with an envelope; the rows live in items.
    var $waiting {
      value = $page|get:"items":[]
    }

    foreach ($waiting) {
      each as $job {
        db.edit relokit_job {
          field_name = "id"
          field_value = $job.id
          data = {attempts: ($job.attempts + 1)}
        }

        function.run "Relokit/execute_op" {
          input = {
            org_id        : $org.id
            run_id        : $input.run_id
            op_id         : $job.call|get:"op_id":""
            capability_id : $job.call|get:"capability_id":""
            endpoint      : $job.call|get:"endpoint":""
            params        : $job.call|get:"params":{}
            constraint_ids: $job.call|get:"constraint_ids":[]
            entity_ids    : $job.call|get:"entity_ids":[]
            ttl_seconds   : $job.call|get:"ttl_seconds":86400
          }
        } as $done

        db.edit relokit_job {
          field_name = "id"
          field_value = $job.id
          data = {status: "done", answer: $done}
        }
      }
    }

    db.query relokit_job {
      where = $db.relokit_job.run_id == $input.run_id && $db.relokit_job.org_id == $org.id && $db.relokit_job.status == "pending" && $db.relokit_job.attempts < 2
      return = {type: "count"}
    } as $pending
  }

  response = {worked: ($waiting|count), pending: $pending}
  guid = "JobsRun9dF2hVx7nWqKtMpLc4eG"
}
