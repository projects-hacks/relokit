//  Keep asking this question.
// 
//  Saves the question and turns nightly re-asking on or off. There is no separate
//  "save" step: a question worth watching is a question worth keeping, and asking
//  somebody to do both would be asking twice.
// 
//  The run it was last answered by is kept, because that is what tomorrow's
//  answer gets compared against.
query watch verb=POST {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    int run_id
    text name filters=trim
    bool enabled?=true
    int interval_minutes?=1440
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org
  
    db.get relokit_run {
      field_name = "id"
      field_value = $input.run_id
    } as $run
  
    precondition ($run != null && $run.org_id == $org.id) {
      error_type = "notfound"
      error = "No such run for this org."
    }
  
    // One watch per question, keyed on the plan it produced. Asking the same
    // thing twice should not make two of them.
    db.query relokit_saved_query {
      where = $db.relokit_saved_query.org_id == $org.id && $db.relokit_saved_query.raw_query == $run.raw_query
      return = {type: "single"}
    } as $existing
  
    var $due {
      value = "now"
        |add_secs_to_timestamp:$input.interval_minutes * 60
    }
  
    conditional {
      if ($existing == null) {
        db.add relokit_saved_query {
          data = {
            created_at            : "now"
            org_id                : $org.id
            name                  : $input.name
            raw_query             : $run.raw_query
            constraint_set        : $run.constraint_set
            watch_enabled         : $input.enabled
            watch_interval_minutes: $input.interval_minutes
            next_due_at           : $due
            last_run_id           : $run.id
          }
        } as $created
      }
    }
  
    conditional {
      if ($existing != null) {
        db.edit relokit_saved_query {
          field_name = "id"
          field_value = $existing.id
          data = {
            watch_enabled         : $input.enabled
            watch_interval_minutes: $input.interval_minutes
            next_due_at           : $due
            last_run_id           : $run.id
          }
        }
      }
    }
  }

  response = {watching: $input.enabled, due_at: $due}
  guid = "BZFYbHFB48fEsDd7GUM6kVJuTvw"
}