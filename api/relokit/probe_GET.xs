// Throwaway. Reports the shape api.request actually returns, because the
// documentation shows how to make a call and not how to read one, and every
// mapper downstream depends on knowing where the status and the body live.
query probe verb=GET {
  api_group = "Relokit"

  input {
  }

  stack {
    api.request {
      url = "https://httpbin.org/get"
      method = "GET"
      params = {}|set:"relokit":"probe"
      headers = []|push:"Accept: application/json"
    } as $call
  }

  response = $call
  guid = "3yETIuWOc3nbHDVua3q1s8rS0AE"
}