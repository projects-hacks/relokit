//   Asking every watched question again, once a day.
// 
//   This is the part of Relokit that cannot live anywhere but here. Everything
//   else runs when somebody is looking; this runs at four in the morning because
//   the answer changes whether or not anyone is watching.
// 
//   The loop is all this does. The work for one question is in
//   Relokit/watch_once, which a person can also start, so what runs overnight is
//   what was tested.
task relokit_watch {
  stack {
    db.query relokit_saved_query {
      where = $db.relokit_saved_query.watch_enabled == true
      return = {type: "list"}
    } as $watched
  
    foreach ($watched) {
      each as $due {
        function.run "Relokit/watch_once" {
          input = {saved_query_id: $due.id}
        } as $checked
      }
    }
  }

  schedule = [{starts_on: 2026-08-30 04:00:00+0000, freq: 86400}]
  guid = "HJhcpgXfry22tGgRHCJG24u_etg"
}