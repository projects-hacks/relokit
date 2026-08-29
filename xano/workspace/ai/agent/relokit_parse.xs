// Transport for the parse call, on Xano's own model key.
//
// Deliberately empty of instructions. The prompt lives in relokit_prompt, loaded
// from packages/llm/src/prompts in the repository, and is passed in as an
// argument. Putting the real prompt here as well would make three copies of it
// and one of them would eventually be the wrong one.
//
// One step, no tools, temperature zero. This is a single completion rather than
// an agent doing anything agentic, and the only reason it is an agent at all is
// that Xano exposes its included model key through agents and not through a
// plain call.
agent "Relokit Parse" {
  llm = {
    type         : "xano-free"
    system_prompt: "Follow the instructions in the message exactly. Answer with JSON only."
    prompt       : "{{ $args.instructions }}\n\n---\n\nQuestion: {{ $args.query }}"
    max_steps    : 1
    temperature  : 0
  }

  tools = []
  guid = "_c0nTLOYoNZEZHaSaku6uCnKN2k"
}
