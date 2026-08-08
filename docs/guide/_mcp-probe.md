Before debugging a client, confirm the endpoint itself is reachable and
authenticating. A request with no token must be rejected:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  https://almanac.example.com/mcp
```

A `401` proves the route is wired and PAT validation is running. Repeat the same
request with `-H 'Authorization: Bearer alm_<your-token>'`.

| Status | Meaning |
| --- | --- |
| 2xx / 400 / 406 | Working. Auth and transport are alive. |
| 401 with a token | The PAT is wrong, revoked, or bound to a different user. |
| 404 | Wrong path. The MCP listener serves `/mcp` and nothing else. |
| 502 | `almanac-mcp` is down. Check `docker compose logs almanac-mcp`. |

**2xx, 400, and 406 all indicate success here.** Each one proves the auth and
transport layers are alive. A barebones POST that doesn't advertise SSE in its
`Accept` header commonly gets 406, which is fine.
