import { z } from 'zod'

const manifestEntrySchema = z
  .object({
    file: z.string().min(1),
    src: z.string().optional(),
    isEntry: z.boolean().optional(),
    css: z.array(z.string().min(1)).optional(),
    imports: z.array(z.string().min(1)).optional()
  })
  .passthrough()

const manifestSchema = z.record(manifestEntrySchema)

export type ClientManifest = z.infer<typeof manifestSchema>

export function parseClientManifest(content: string): ClientManifest {
  return manifestSchema.parse(JSON.parse(content))
}

export function referencedClientFiles(
  manifest: ClientManifest
): readonly string[] {
  return [
    ...new Set(
      Object.values(manifest).flatMap(entry => [
        entry.file,
        ...(entry.css ?? [])
      ])
    )
  ].sort()
}
