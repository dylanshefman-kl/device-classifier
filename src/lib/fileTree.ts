export type FileTreeNode = {
  name: string
  /** Unique path key (rootName/a/b) */
  path: string
  children?: FileTreeNode[]
}

export type PointRecord = {
  /** Original CSV path value including leaf (point) segment. */
  path: string
  /** Display-only type label for this point (already normalized by caller). */
  type: string
}

export const decodeStandardName = (value: string): string => {
  // Replace $XX hex sequences with their ASCII character.
  // Example: "My$20Folder" -> "My Folder"
  return value.replace(/\$([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

const normalizePath = (value: string): string => value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')

const splitFolderSegments = (pathValue: string): string[] => {
  const normalized = normalizePath(pathValue)
  if (!normalized) return []

  const rawSegments = normalized
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)

  // Ignore the final segment (file/point). We only render folders.
  if (rawSegments.length <= 1) return []
  return rawSegments.slice(0, -1)
}

export function buildFolderTreeFromPaths(paths: string[], rootName = 'root'): FileTreeNode {
  const root: FileTreeNode = { name: rootName, path: rootName, children: [] }

  // Map of "path key" -> node, to share nodes across identical folders.
  const nodeByKey = new Map<string, FileTreeNode>()
  nodeByKey.set(rootName, root)

  for (const p of paths) {
    const segments = splitFolderSegments(p)
    if (segments.length === 0) continue

    let currentKey = rootName
    let currentNode = root

    for (const seg of segments) {
      const nextKey = `${currentKey}/${seg}`
      let nextNode = nodeByKey.get(nextKey)

      if (!nextNode) {
        nextNode = { name: decodeStandardName(seg), path: nextKey, children: [] }
        nodeByKey.set(nextKey, nextNode)
        currentNode.children ??= []
        currentNode.children.push(nextNode)
      }

      currentKey = nextKey
      currentNode = nextNode
    }
  }

  const sortRec = (node: FileTreeNode) => {
    if (!node.children?.length) return
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    node.children.forEach(sortRec)
  }
  sortRec(root)

  return root
}

const stripRootPrefix = (segments: string[]) => {
  if (segments.length > 0 && segments[0] === 'root') return segments.slice(1)
  return segments
}

const toComparableSegments = (value: string): string[] =>
  stripRootPrefix(
    normalizePath(value)
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean),
  )

export type PathRelation = 'same' | 'ancestor' | 'descendant' | 'disjoint'

/**
 * Compares two folder path keys (e.g. "root/a/b") ignoring a leading "root" segment.
 *
 * - "ancestor": a is a strict ancestor of b
 * - "descendant": a is a strict descendant of b
 */
export function getPathRelation(a: string, b: string): PathRelation {
  const aSegs = toComparableSegments(a)
  const bSegs = toComparableSegments(b)
  if (!aSegs.length || !bSegs.length) return 'disjoint'

  const minLen = Math.min(aSegs.length, bSegs.length)
  for (let i = 0; i < minLen; i++) {
    if (aSegs[i] !== bSegs[i]) return 'disjoint'
  }

  if (aSegs.length === bSegs.length) return 'same'
  if (aSegs.length < bSegs.length) return 'ancestor'
  return 'descendant'
}

/**
 * Returns unique leaf ("point") names that descend from the given folder path.
 *
 * `folderPath` is expected to be a folder-node path key (e.g. "root/a/b"),
 * while `fullPaths` are the original CSV path values including leaf entries.
 */
export function listLeafPointsUnderFolder(folderPath: string, fullPaths: string[]): string[] {
  const folderSegs = stripRootPrefix(normalizePath(folderPath).split('/').filter(Boolean))
  const out = new Set<string>()

  for (const p of fullPaths) {
    const segs = stripRootPrefix(normalizePath(p).split('/').map((s) => s.trim()).filter(Boolean))
    if (segs.length <= 1) continue

    const leaf = segs[segs.length - 1]!
    const folders = segs.slice(0, -1)

    let matches = true
    for (let i = 0; i < folderSegs.length; i++) {
      if (folders[i] !== folderSegs[i]) {
        matches = false
        break
      }
    }
    if (!matches) continue

    out.add(leaf)
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b))
}

export type LeafPointsByType = {
  type: string
  points: string[]
}

/**
 * Returns leaf point names grouped by point type for the given folder.
 *
 * `folderPath` is expected to be a folder-node path key (e.g. "root/a/b"),
 * while `points` are the original CSV path values (including leaf) paired with
 * a display-only type label.
 */
export function listLeafPointsUnderFolderByType(folderPath: string, points: PointRecord[]): LeafPointsByType[] {
  const folderSegs = stripRootPrefix(normalizePath(folderPath).split('/').filter(Boolean))

  const pointsByType = new Map<string, Set<string>>()

  for (const row of points) {
    const segs = stripRootPrefix(normalizePath(row.path).split('/').map((s) => s.trim()).filter(Boolean))
    if (segs.length <= 1) continue

    const leaf = segs[segs.length - 1]!
    const folders = segs.slice(0, -1)

    let matches = true
    for (let i = 0; i < folderSegs.length; i++) {
      if (folders[i] !== folderSegs[i]) {
        matches = false
        break
      }
    }
    if (!matches) continue

    const typeLabel = (row.type ?? '').trim() || 'Unknown'
    let set = pointsByType.get(typeLabel)
    if (!set) {
      set = new Set<string>()
      pointsByType.set(typeLabel, set)
    }
    set.add(leaf)
  }

  return Array.from(pointsByType.entries())
    .map(([type, set]) => ({ type, points: Array.from(set).sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.type.localeCompare(b.type))
}

export function isDownstreamOfAnyFolderPath(path: string, ancestorPaths: string[]): boolean {
  const pathSegs = stripRootPrefix(normalizePath(path).split('/').map((s) => s.trim()).filter(Boolean))
  if (!pathSegs.length) return false

  for (const a of ancestorPaths) {
    const ancSegs = stripRootPrefix(normalizePath(a).split('/').map((s) => s.trim()).filter(Boolean))
    if (!ancSegs.length) continue
    if (pathSegs.length <= ancSegs.length) continue

    let matches = true
    for (let i = 0; i < ancSegs.length; i++) {
      if (pathSegs[i] !== ancSegs[i]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }

  return false
}

export function isAtOrDownstreamOfAnyFolderPath(path: string, ancestorPaths: string[]): boolean {
  const pathSegs = stripRootPrefix(normalizePath(path).split('/').map((s) => s.trim()).filter(Boolean))
  if (!pathSegs.length) return false

  for (const a of ancestorPaths) {
    const ancSegs = stripRootPrefix(normalizePath(a).split('/').map((s) => s.trim()).filter(Boolean))
    if (!ancSegs.length) continue
    if (pathSegs.length < ancSegs.length) continue

    let matches = true
    for (let i = 0; i < ancSegs.length; i++) {
      if (pathSegs[i] !== ancSegs[i]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }

  return false
}
