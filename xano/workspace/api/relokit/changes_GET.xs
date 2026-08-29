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
  
    // Asking the same question again produces a new run, but the watch keeps
    // hanging its nights off the run that started it. Reading the history
    // through the saved question rather than the run in hand is what lets a
    // re-ask still show what has moved since.
    var $anchor_id {
      value = $run.id
    }
  
    conditional {
      if ($saved != null) {
        var $anchor_id {
          value = $saved.last_run_id
        }
      }
    }
  
    db.get relokit_run {
      field_name = "id"
      field_value = $anchor_id
    } as $anchor
  
    // Every re-asking of this question, oldest first.
    db.query relokit_run {
      where = $db.relokit_run.org_id == $org.id && $db.relokit_run.parent_run_id == $anchor_id
      return = {type: "list"}
    } as $children
  
    // Only the most recent asking. A question watched for a week has a week of
    // diffs behind it, and showing them together would present last Tuesday as
    // news. What changed since you asked is one night's worth.
    var $latest {
      value = $children|last
    }
  
    var $changes {
      value = []
    }
  
    var $last_asked_at {
      value = null
    }
  
    conditional {
      if (($children|count) > 0) {
        db.query relokit_run_diff {
          where = $db.relokit_run_diff.run_id == $latest.id
          return = {type: "list"}
        } as $changes
      
        var $last_asked_at {
          value = $latest.created_at
        }
      }
    }
  
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
          value = $latest|get:"actual_cost_units":0
        }
      }
    }
  }

  response = {
    watching  : $watching
    due_at    : $due_at
    re_asked  : $children|count
    last_cost : $last_cost
    first_cost: $anchor|get:"actual_cost_units":0
    asked_at  : $last_asked_at
    changes   : $changes
  }

  guid = "LX0SJnUNp0S-eQaRvs2iM5N1NXE"
}