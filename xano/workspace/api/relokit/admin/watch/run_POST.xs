//   Start a watch by hand.
// 
//   The same function the schedule calls, so what is tested at noon is what runs
//   at four in the morning. Admin guarded rather than org guarded, because it is
//   a maintenance handle rather than something the product offers.
query "admin/watch/run" verb=POST {
  api_group = "Relokit"

  input {
    text admin_key filters=trim
    int saved_query_id
  }

  stack {
    precondition ($env.relokit_admin_key != null) {
      error_type = "unauthorized"
      error = "Relokit has no admin key configured on this instance."
    }
  
    precondition ($input.admin_key == $env.relokit_admin_key) {
      error_type = "unauthorized"
      error = "Admin key missing or wrong."
    }
  
    function.run "Relokit/watch_once" {
      input = {saved_query_id: $input.saved_query_id}
    } as $checked
  }

  response = $checked
  guid = "fFWXHCA1Ptdz4xeJW8NlXl0SU7I"
}