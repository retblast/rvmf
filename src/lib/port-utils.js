// Pure helpers for the "auto-climb to the next free port" behavior shared by
// the standalone server (server.mjs) and its regression tests. Keeping the
// decision logic here (rather than inline in the server) lets us unit-test it
// deterministically without binding real sockets.

export const MAX_PORT = 65535

// The next port to try after `current`, or null once the valid range is
// exhausted. The server climbs on EADDRINUSE so a dev code reload doesn't
// crash an already-running instance that grabbed the default port.
export function nextPort(current, max = MAX_PORT) {
  if (!Number.isInteger(current) || current < 0) return max > 0 ? 1 : null
  return current < max ? current + 1 : null
}

// Human-readable notice shown before the server retries on a new port.
export function portClimbedNotice(fromPort, toPort) {
  return `Port ${fromPort} is already in use — retrying on ${toPort}.`
}
