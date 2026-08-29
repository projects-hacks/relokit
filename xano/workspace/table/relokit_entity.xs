// A thing that can be rented, or a place near one.
//
// A search result is not always a listing: four fifths of San Jose rental
// results are buildings carrying a price band per bedroom count, so one result
// becomes one entity per band. point is nullable because a small share arrive
// without coordinates, and those stay in the run and go unverified on anything
// positional rather than being dropped.
table relokit_entity {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    int org_id { table = "relokit_org" }
    text entity_id filters=trim
    enum kind { values = ["listing", "place"] }
    text provider filters=trim
    text provider_entity_id? filters=trim
    decimal lat?
    decimal lng?
    text address_normalized? filters=trim
    json display?
    timestamp last_seen_at?=now
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "org_id", op: "asc"}, {name: "entity_id", op: "asc"}]}
  ]
  guid = "LVn7ibVS5y_dTyZWHxvy2K5ENLI"
}
