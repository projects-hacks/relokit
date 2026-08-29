//  The identity of a call.
// 
//  Two requests with the same parameters are the same question however the
//  parameters were ordered, so the key is built from sorted names rather than
//  from the encoded object. Hashing the object directly makes ordering part of
//  the identity, which is invisible and wrong: the cache was warmed with engine
//  written last and the executor asked with engine written first, so nothing
//  matched and thirty eight searches were spent proving it.
// 
//  Both the executor and the warmer call this, so there is one definition of what
//  makes two calls the same and they cannot drift apart.
function "Relokit/params_hash" {
  input {
    text endpoint filters=trim
    json params
  }

  stack {
    var $names {
      value = $input.params|keys|sort
    }
  
    var $canonical {
      value = $input.endpoint
    }
  
    foreach ($names) {
      each as $name {
        var $canonical {
          value = $canonical ~ "|" ~ $name ~ "=" ~ ($input.params|get:$name:"")
        }
      }
    }
  }

  response = $canonical|sha256
  guid = "gyXtPAYdDPYZ6k9ST8-_vYNBvoA"
}