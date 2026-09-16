/**
 * Small HTTP helpers shared by the route handlers.
 *
 * Lives here rather than in `src/lib` because it deals in `Request` and
 * `Response` streams — Worker runtime concerns, not the pure parse-and-compute
 * that `src/lib` is reserved for.
 */

/**
 * Reads a body but refuses to buffer more than `maxBytes`, returning `null`
 * instead.
 *
 * `content-length` is not trusted for this: it can be absent on a chunked
 * body and it can simply lie, so the only honest cap is counting bytes as
 * they arrive and cancelling when the count is exceeded.
 */
export async function readCapped(
  body: Response | Request,
  maxBytes: number,
): Promise<string | null> {
  const reader = body.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}
