export class JsonBodyError extends Error {
  constructor(readonly code: 'body-too-large' | 'invalid-json') {
    super(code)
    this.name = 'JsonBodyError'
  }
}

export async function readJsonWithLimit(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new JsonBodyError('body-too-large')

  const reader = request.body?.getReader()
  if (!reader) throw new JsonBodyError('invalid-json')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    let complete = false
    while (!complete) {
      const { done, value } = await reader.read()
      complete = done
      if (complete) break
      if (!value) throw new JsonBodyError('invalid-json')
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('body-too-large')
        throw new JsonBodyError('body-too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown
  } catch (error) {
    if (error instanceof JsonBodyError) throw error
    throw new JsonBodyError('invalid-json')
  }
}
