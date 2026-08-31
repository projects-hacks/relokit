//  Loads a prompt from the repository into the instance.
// 
//  Same shape as the registry import and for the same reason: the file in git is
//  the source, this is how it gets here, and nothing edits the row by hand.
query "admin/prompt/import" verb=POST {
  api_group = "Relokit"

  input {
    text admin_key filters=trim
    text version filters=trim
    text body
    text model? filters=trim
  }

  stack {
    // Shut while the admin key rotates: it appeared in the public git history
    // on 30 Aug and stays untrusted until replaced.
    precondition (false) {
      error_type = "unauthorized"
      error = "Admin endpoints are disabled during key rotation."
    }
  
    precondition ($env.relokit_admin_key != null) {
      error_type = "unauthorized"
      error = "Relokit has no admin key configured on this instance."
    }
  
    precondition ($input.admin_key == $env.relokit_admin_key) {
      error_type = "unauthorized"
      error = "Admin key missing or wrong."
    }
  
    db.query relokit_prompt {
      where = $db.relokit_prompt.version == $input.version
      return = {type: "single"}
    } as $existing
  
    conditional {
      if ($existing == null) {
        db.add relokit_prompt {
          data = {
            created_at: "now"
            version   : $input.version
            body      : $input.body
            model     : $input.model
          }
        }
      }
    }
  
    conditional {
      if ($existing != null) {
        db.edit relokit_prompt {
          field_name = "id"
          field_value = $existing.id
          data = {body: $input.body, model: $input.model}
        }
      }
    }
  }

  response = {version: $input.version, replaced: ($existing != null)}
  guid = "rHDi0blCzzYedeOehlrT5E59340"
}