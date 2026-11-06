/**
 * Reads a request body as text with a running byte count and stops at the cap, so a missing or false Content-Length
 * cannot make the server buffer an unbounded body. Shared by the public /ebook routes.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413 }> {
  try {
    const reader = request.body?.getReader();
    if (!reader) return { ok: false, status: 400 };
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
    return { ok: true, text: text + decoder.decode() };
  } catch {
    return { ok: false, status: 400 };
  }
}
