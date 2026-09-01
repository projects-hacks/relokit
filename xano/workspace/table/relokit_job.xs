//  One call waiting its turn.
//
//  A run used to hold a connection open for every call while a third party
//  thought about it, and the requests themselves became the load. Work now
//  waits here instead: enqueued in one request, executed a few at a time by
//  short polls, each poll finishing whatever it starts because writes survive
//  an abort (measured, not assumed).
//
//  attempts is written before execution, so a call that kills its poll is
//  still counted against; two strikes and the pickers pass over it.
table relokit_job {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int org_id
    int run_id

    // pending -> done, or passed over once attempts reaches two.
    text status?="pending" filters=trim
    int attempts?=0

    // The op inputs, exactly as the single endpoint takes them.
    json call

    // What came back, for the caller to collect.
    json answer?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [{name: "run_id", op: "asc"}, {name: "status", op: "asc"}]
    }
  ]

  guid = "JobQueue7fKp2WmXr9tYcLnB0dE"
}
