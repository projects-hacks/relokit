// Turns a question into constraints, and hands back the registry to plan with.
//
// What this returns is the model's answer, not a finished constraint set. The
// repair that follows re-reads every number out of the words the person wrote,
// because a model is good at spotting that a phrase is a budget and bad at
// turning it into cents. Asked for "open past 10pm" one answered 36000 seconds,
// which is ten in the morning, and filed it under opening rather than closing.
// Nothing in a schema catches either mistake.
//
// That repair runs in the caller, alongside the planner, because it is
// deterministic and costs nothing. Two implementations of it would eventually be
// two behaviours. What stays here is what holds a key or spends money.
//
// Because every number is re-derived, the model has two jobs left: name the kind
// of constraint, and copy the span it came from verbatim. That is a small enough
// job for the model included with the instance, which answers better than the
// paid fallback on the two things a schema cannot check.
//
// Two things follow from the credits being finite. They are documented as
// development credits that do not reset, so the answer is cached: the same
// question under the same prompt has the same meaning tomorrow, and a rehearsal
// should not cost a credit. And exhaustion is a fall-through rather than a
// failure, because a demo should degrade to the paid provider rather than stop.
query parse verb=POST {
  api_group = "Relokit"

  input {
    text org_key filters=trim
    text query filters=trim
    text prompt_version?="parse.v1.md"
    // xano uses the model key included with the instance. nvidia is the
    // fallback, kept because a demo should not rest on one provider being up.
    text provider?="xano"
    text model?="mistralai/mistral-nemotron"
  }

  stack {
    function.run "Relokit/require_org" {
      input = {org_key: $input.org_key}
    } as $org

    db.query relokit_prompt {
      where = $db.relokit_prompt.version == $input.prompt_version
      return = {type: "single"}
    } as $prompt

    precondition ($prompt != null) {
      error = "This instance has no prompt " ~ $input.prompt_version
    }

    // The same question under the same prompt is the same answer. This is the
    // one call in the system whose meaning does not expire.
    var $cache_key {
      value = ($input.query ~ "|" ~ $input.prompt_version)|sha256
    }

    db.query relokit_provider_cache {
      where = $db.relokit_provider_cache.endpoint == "llm:parse" && $db.relokit_provider_cache.params_hash == $cache_key
      return = {type: "single"}
    } as $cached

    var $text {
      value = null
    }

    var $answered_by {
      value = "cache"
    }

    conditional {
      if ($cached != null) {
        var $text {
          value = $cached.raw_response|get:"text"
        }
      }
    }

    conditional {
      if ($text == null && $input.provider == "xano") {
        ai.agent.run "Relokit Parse" {
          args = {}
            |set:"instructions":$prompt.body
            |set:"query":$input.query
        } as $agent

        // ai.agent.run answers with {finishReason, providerMetadata,
        // reasoningDetails, result}. The text is result.
        var $text {
          value = $agent.result
        }

        var $answered_by {
          value = "xano"
        }
      }
    }

    // Reached when the caller asked for the fallback, and also when the included
    // credits have run out and the agent came back with nothing. The second case
    // is the reason this is a condition on the text rather than on the provider.
    conditional {
      if ($text == null && $env.nvidia_api_key != null) {

        var $messages {
          value = []
            |array_push:({}|set:"role":"system"|set:"content":$prompt.body)
            |array_push:({}|set:"role":"user"|set:"content":$input.query)
        }

        api.request {
          url = "https://integrate.api.nvidia.com/v1/chat/completions"
          method = "POST"
          params = ({}
            |set:"model":$input.model
            |set:"temperature":0
            |set:"max_tokens":2000
            |set:"messages":$messages)
          headers = []
            |array_push:("Authorization: Bearer " ~ $env.nvidia_api_key)
            |array_push:"Content-Type: application/json"
        } as $call

        // A model listed in a catalogue is not always provisioned for a given
        // account, and one that is not answers 404 naming an internal function
        // id rather than the model. Say so plainly rather than letting it read
        // as a parse failure.
        precondition ($call.response.status == 200) {
          error = "The fallback model refused the request with " ~ ($call.response.status)
        }

        var $message {
          value = $call.response.result.choices|first|get:"message"
        }

        var $text {
          value = $message|get:"content"
        }

        // A reasoning model leaves content null and puts its answer in
        // reasoning_content when the token budget runs out mid-thought.
        conditional {
          if ($text == null) {
            var $text {
              value = $message|get:"reasoning_content"
            }
          }
        }

        var $answered_by {
          value = "nvidia"
        }
      }
    }

    precondition ($text != null) {
      error = "No model answered. The included credits may be spent and no fallback key is set."
    }

    conditional {
      if ($cached == null) {
        db.add relokit_provider_cache {
          data = {
            created_at  : "now"
            endpoint    : "llm:parse"
            params_hash : $cache_key
            params      : ({}|set:"query":$input.query|set:"prompt_version":$input.prompt_version)
            raw_response: ({}|set:"text":$text|set:"answered_by":$answered_by)
            ttl_seconds : 2592000
            expires_at  : ("now"|add_secs_to_timestamp:2592000)
            cost_units  : 1
          }
        }
      }
    }

    // The registry travels with the answer so the caller can plan immediately.
    // Only enabled rows: a disabled capability is one /run would refuse anyway,
    // and offering it would produce a plan built to be rejected.
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
    answered_by     : $answered_by
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
