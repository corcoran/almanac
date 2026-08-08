::: warning A local URL only works for local clients
Claude Code, and anything else running on the same machine, can reach
`localhost` or a LAN address. Claude's and ChatGPT's web and mobile apps cannot:
they connect from the vendor's servers, so `localhost` is *their* localhost and
a `192.168.x` address isn't routable from outside your network. Those clients
need Almanac published at a public HTTPS domain — see the
[deploy runbook](/guide/deploy). The app detects this and adjusts the connect
instructions it shows you.
:::
