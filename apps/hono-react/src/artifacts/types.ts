export interface ArtifactEntry {
  key: string
  path: string
  sha256: string
}

export interface ClientArtifactIndex {
  manifest: ArtifactEntry
  assets: ArtifactEntry[]
  staticAssets: ArtifactEntry[]
}

export interface BuildArtifactIndex {
  formatVersion: 1
  fragments: ArtifactEntry[]
  templates: ArtifactEntry[]
  client: ClientArtifactIndex
}
