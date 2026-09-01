//  What the queue holds for a run: answers for the done, and which jobs were
//  passed over after two strikes, so the caller can record them as failures
//  rather than waiting on them forever.
query jobs verb=GET {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    text run_id filters=trim
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org

    db.query relokit_job {
      where = $db.relokit_job.run_id == ($input.run_id|to_int) && $db.relokit_job.org_id == $org.id
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $page
  }

  response = {jobs: $page|get:"items":[]}
  guid = "JobsGet3mQ8xZk5rTnWvPcYd7hJ"
}
