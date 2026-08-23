export const REQUIRED_DOCUMENT_SLOTS = [
  'navigation',
  'page-body',
  'footer',
  'client-assets'
] as const
export type DocumentSlot = (typeof REQUIRED_DOCUMENT_SLOTS)[number]

export function slotToken(slot: DocumentSlot): string {
  return `<!--slot:${slot}-->`
}

export function createDocumentShell(): string {
  return `<!doctype html>
<html lang="<!--document:language-->" data-country="<!--document:country-->">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f4efe4">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>Lesshub Field Supply</title>
${slotToken('client-assets')}
</head>
<body>
${slotToken('navigation')}
${slotToken('page-body')}
${slotToken('footer')}
</body>
</html>`
}

export function verifyDocumentSlots(shell: string): void {
  const discovered = [...shell.matchAll(/<!--slot:([^>]+)-->/g)].map(
    match => match[1]
  )
  for (const slot of discovered) {
    if (!REQUIRED_DOCUMENT_SLOTS.includes(slot as DocumentSlot))
      throw new Error(`Unknown document slot: ${String(slot)}`)
  }
  for (const slot of REQUIRED_DOCUMENT_SLOTS) {
    const token = slotToken(slot)
    const count = discovered.filter(candidate => candidate === slot).length
    if (count !== 1)
      throw new Error(
        `Document shell requires exactly one ${token}; found ${count}`
      )
  }
}
