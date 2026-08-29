//  What moved since this question was last asked.
// 
//  Empty is the ordinary answer and is worth saying plainly: nothing changing is
//  the result, not the absence of one.
query changes verb=GET {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    text run_id filters=trim
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org
  
    db.get relokit_run {
      field_name = "id"
      field_value = $input.run_id|to_int
    } as $run
  
    precondition ($run != null && $run.org_id == $org.id) {
      error_type = "notfound"
      error = "No such run for this org."
    }
  
    db.query relokit_saved_query {
      where = $db.relokit_saved_query.org_id == $org.id && $db.relokit_saved_query.raw_query == $run.raw_query
      return = {type: "single"}
    } as $saved
  
    // Every re-asking of this question, newest first.
    db.query relokit_run {
      where = $db.relokit_run.org_id == $org.id && $db.relokit_run.parent_run_id == $run.id
      return = {type: "list"}
    } as $children
  
    db.query relokit_run_diff {
      where = $db.relokit_run_diff.prev_run_id == $run.id
      return = {type: "list"}
    } as $changes
  
    var $watching {
      value = false
    }
  
    var $due_at {
      value = null
    }
  
    conditional {
      if ($saved != null) {
        var $watching {
          value = $saved.watch_enabled
        }
      
        var $due_at {
          value = $saved.next_due_at
        }
      }
    }
  
    // The point of the ledger in one number: what asking again cost, beside
    // what asking the first time cost.
    var $last_cost {
      value = null
    }
  
    conditional {
      if (($children|count) > 0) {
        var $last_cost {
          value = $children|last|get:"actual_cost_units"
        }
      }
    }
  }

  response = {
    watching  : $watching
    due_at    : $due_at
    re_asked  : $children|count
    last_cost : $last_cost
    first_cost: $run.actual_cost_units
    changes   : $changes
  }

  guid = "LX0SJnUNp0S-eQaRvs2iM5N1NXE"
}