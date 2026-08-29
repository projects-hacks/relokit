// Turns a question into constraints, and hands back the registry to plan with.
//
// What this returns is the model's answer, not a finished constraint set. The
// repair that follows is pure: it re-reads every number out of the words the
// person wrote, because a model is good at spotting that a phrase is a budget
// and bad at turning it into cents. Asked for "open past 10pm" it answered
// 36000 seconds, which is ten in the morning, and filed it under opening rather
// than closing. Nothing in a schema catches either mistake.
//
// That repair runs in the caller, alongside the planner, for the same reason the
// planner does: it is deterministic and it costs nothing. Splitting it across
// two implementations would give it two behaviours. What stays here is what
// holds a key or spends money.
query parse verb=POST {
  api_group = "Relokit"

  input {
    text query filters=trim
    text prompt_version?="parse.v1.md"
    text model?="mistralai/mistral-nemotron"
  }

  stack {
    function.run "Relokit/require_org" as $org

    precondition ($env.nvidia_api_key != null) {
      error_type = "unauthorized"
      error = "No model key is configured on this instance."
    }

    db.query relokit_prompt {
      where = $db.relokit_prompt.version == $input.prompt_version
      return = {type: "single"}
    } as $prompt

    precondition ($prompt != null) {
      error = "This instance has no prompt " ~ $input.prompt_version
    }

    var $messages {
      value = []
        |array_push:({}|set:"role":"system"|set:"content":$prompt.body)
        |array_push:({}|set:"role":"user"|set:"content":$input.query)
    }

    var $body {
      value = {}
        |set:"model":$input.model
        |set:"temperature":0
        |set:"max_tokens":2000
        |set:"messages":$messages
    }

    api.request {
      url = "https://integrate.api.nvidia.com/v1/chat/completions"
      method = "POST"
      params = $body
      headers = []
        |array_push:("Authorization: Bearer " ~ $env.nvidia_api_key)
        |array_push:"Content-Type: application/json"
    } as $call

    // A model that is listed in the catalogue is not always provisioned for a
    // given account, and one that is not answers 404 naming an internal function
    // id rather than the model. Say so plainly rather than letting it read as a
    // parse failure.
    precondition ($call.response.status == 200) {
      error = "The model refused the request: " ~ ($call.response.status)
    }

    var $message {
      value = $call.response.result.choices|first|get:"message"
    }

    // A reasoning model leaves content null and puts the answer in
    // reasoning_content when its token budget runs out mid-thought.
    var $text {
      value = $message|get:"content"
    }

    conditional {
      if ($text == null) {
        var $text {
          value = $message|get:"reasoning_content"
        }
      }
    }

    precondition ($text != null) {
      error = "The model returned nothing to read."
    }

    // The registry travels with the answer so the caller can plan immediately.
    // Only enabled rows, because a disabled capability is one /run would refuse
    // anyway, and offering it would produce a plan built to be rejected.
    db.query relokit_capability {
      where = $db.relokit_capability.enabled == true
      return = {type: "list"}
    } as $registry

    var $registry_version {
      value = $registry|first|get:"registry_version"
    }
  }

  response = {
    raw_text        : $text
    model           : $input.model
    prompt_version  : $input.prompt_version
    registry        : $registry
    registry_version: $registry_version
    budget          : {
      max_cost_units  : 200
      max_stages      : 6
      cluster_count   : 6
      overshoot_factor: 1.3
    }
  }
  guid = "G6y6sj5qKIdVf41-6AHE_vnmU2A"
}
