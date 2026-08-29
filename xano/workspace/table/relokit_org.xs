//  Who is asking, and how much they are allowed to spend.
// 
//  Every fact in this backend costs a paid search, so a tenant is a spending
//  boundary before it is anything else.
table relokit_org {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    text name filters=trim
  
    // Hashed, never the key itself. A leaked table should not be a leaked account.
    text api_key_hash filters=trim
  
    int monthly_cost_units_cap?=5000
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree|unique"
      field: [{name: "api_key_hash", op: "asc"}]
    }
  ]

  guid = "PaMrEhR6kzOISDB_AQAEcOkeA4o"
}