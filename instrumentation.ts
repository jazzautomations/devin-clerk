import type { Instrumentation } from "next";

// Uma linha JSON por erro de servidor, com a rota. O digest é o mesmo que a
// tela de erro mostra como "código de referência":
//   journalctl -u hackahub-prod -o cat | grep request_error | jq
export function requestErrorLine(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
): string {
  const e = err as { message?: unknown; digest?: unknown } | null;
  return JSON.stringify({
    evt: "request_error",
    ts: new Date().toISOString(),
    digest: e && e.digest !== undefined ? String(e.digest) : undefined,
    msg: String(e?.message ?? err).slice(0, 300),
    method: request.method,
    // sem query string: pode carregar token (rsvp, convite)
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
  });
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  console.error(requestErrorLine(err, request, context));
};
