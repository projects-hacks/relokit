// Prompts, kept as data for the same reason the registry is.
//
// A prompt is the part of this system most likely to change between now and the
// demo, and embedding one in a function stack makes every wording change a
// deploy and makes drift from the copy in the repository invisible. Imported
// from packages/llm/src/prompts, addressed by the filename that parser_version
// already records, so a constraint set can always be traced to the words that
// produced it.
table relokit_prompt {
  auth = false

  schema {
    int id
    timestamp created_at?=now
    // The filename, e.g. "parse.v1.md". Matches parser_version on a parsed set.
    text version filters=trim
    text body
    text model? filters=trim
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "version", op: "asc"}]}
  ]
  guid = "nI8v-i9sNwnQsdPOEOGVC6VUVyw"
}
