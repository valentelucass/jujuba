export interface DocumentPreview {
  title: string
  json: string
  truncated: boolean
}

export interface DocumentsPage {
  documents: DocumentPreview[]
  hasNext: boolean
}

export interface RedisKey {
  id: string
  name: string
}

export interface RedisKeys {
  keys: RedisKey[]
  next: string | null
}

export interface RedisEntry {
  kind: string
  ttl: number
  value: unknown
  truncated: boolean
}
