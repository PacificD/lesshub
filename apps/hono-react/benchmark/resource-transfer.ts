export interface ResourceTransferEntry {
  name: string
  bytes: number
}

function pathnameExtension(name: string): string | undefined {
  try {
    const pathname = new URL(name, 'http://benchmark.invalid').pathname.toLowerCase()
    const match = /\.([a-z0-9]+)$/.exec(pathname)
    return match?.[1]
  } catch {
    return undefined
  }
}

export function transferBytesForExtension(
  resources: readonly ResourceTransferEntry[],
  extension: 'js' | 'css'
): number {
  return resources
    .filter(resource => pathnameExtension(resource.name) === extension)
    .reduce((sum, resource) => sum + Math.max(0, resource.bytes), 0)
}
