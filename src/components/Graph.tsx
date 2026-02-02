import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { ChevronDown, ChevronRight, Info, Plus } from 'lucide-react'
import type { FileTreeNode } from '../lib/fileTree'
import type { PointRecord } from '../lib/fileTree'
import { isDownstreamOfAnyFolderPath } from '../lib/fileTree'
import { isAtOrDownstreamOfAnyFolderPath } from '../lib/fileTree'
import { listLeafPointsUnderFolderByType } from '../lib/fileTree'
import { decodeStandardName } from '../lib/fileTree'

type Props = {
  treeData: FileTreeNode | null
  devicePaths: string[]
  mergedDevicePaths: string[]
  hiddenFolderPaths: string[]
  points: PointRecord[]
  onUnhideHiddenFolders: (paths: string[]) => void
  deviceCount: number
  selectedPaths: string[]
  statsReady: boolean
  totalPointsCount: number
  unassignedPointsCount: number
  unassignedFolderPaths: string[]
  onSelectSingle: (path: string) => void
  onToggleSelected: (path: string) => void
  onSetSelection: (paths: string[]) => void
  columns: string[]
  selectedColumn: string
  selectedTypeColumn: string
  onUploadCsv: (file: File) => void | Promise<void>
  onSelectColumn: (column: string) => void
  onSelectTypeColumn: (column: string) => void
  onExportCsv: () => void
  exportDisabled: boolean
  onOpenHelp: () => void
}

export default function Graph({
  treeData,
  devicePaths,
  mergedDevicePaths,
  hiddenFolderPaths,
  points,
  onUnhideHiddenFolders,
  deviceCount,
  selectedPaths,
  statsReady,
  totalPointsCount,
  unassignedPointsCount,
  unassignedFolderPaths,
  onSelectSingle,
  onToggleSelected,
  onSetSelection,
  columns,
  selectedColumn,
  selectedTypeColumn,
  onUploadCsv,
  onSelectColumn,
  onSelectTypeColumn,
  onExportCsv,
  exportDisabled,
  onOpenHelp,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const miniRef = useRef<SVGSVGElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const graphBodyRef = useRef<HTMLDivElement | null>(null)
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)
  const minimapWidthRef = useRef<number>(120)
  const navigateToFolderRef = useRef<((folderPath: string) => boolean) | null>(null)
  const nextUnassignedIndexRef = useRef<number>(0)

  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [hiddenChecked, setHiddenChecked] = useState<string[]>([])
  const [hiddenExpandedKeys, setHiddenExpandedKeys] = useState<string[]>([])
  const [hiddenCollapsedTypeKeys, setHiddenCollapsedTypeKeys] = useState<string[]>([])

  const unassignedPct = totalPointsCount
    ? Math.round((unassignedPointsCount / totalPointsCount) * 1000) / 10
    : 0

  const sortedHidden = useMemo(() => [...hiddenFolderPaths].sort((a, b) => a.localeCompare(b)), [hiddenFolderPaths])
  const hiddenCheckedSet = useMemo(() => new Set(hiddenChecked), [hiddenChecked])
  const hiddenExpandedSet = useMemo(() => new Set(hiddenExpandedKeys), [hiddenExpandedKeys])
  const hiddenTypeCollapsedSet = useMemo(() => new Set(hiddenCollapsedTypeKeys), [hiddenCollapsedTypeKeys])
  const displayPath = (p: string) => (p.startsWith('root/') ? p.slice('root/'.length) : p)
  const hiddenTypeKey = (parentPath: string, type: string) => `${parentPath}::${type}`

  useEffect(() => {
    if (!svgRef.current || !miniRef.current || !wrapperRef.current) return

    const svg = d3.select(svgRef.current)
    const miniSvg = d3.select(miniRef.current)
    const wrapper = wrapperRef.current

    const isMac =
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/i.test((navigator as any).platform ?? navigator.userAgent ?? '')

    const isMultiSelectModifier = (eventLike: any): boolean => {
      const e = eventLike?.sourceEvent ?? eventLike
      if (!e) return false
      return isMac ? !!e.metaKey : !!e.ctrlKey
    }

    let currentZoomTransform = zoomTransformRef.current
    let isBoxSelecting = false
    let boxStart: [number, number] | null = null
    let baseSelection: Set<string> | null = null
    let previewPicked: Set<string> = new Set()
    let rafId: number | null = null
    let pendingRect: [[number, number], [number, number]] | null = null

      const render = () => {
      const mainRect = svgRef.current?.getBoundingClientRect()
      const miniRect = miniRef.current?.getBoundingClientRect()
      const w = Math.max(320, Math.floor(mainRect?.width ?? 0))
      const h = Math.max(240, Math.floor(mainRect?.height ?? 0))
      const miniH = Math.max(160, Math.floor(miniRect?.height ?? Math.round(h * 0.8)))
      let miniW = minimapWidthRef.current

      svg.attr('viewBox', `0 0 ${w} ${h}`)

      svg.selectAll('*').remove()
      miniSvg.selectAll('*').remove()

      const selectedSet = new Set(selectedPaths)

      if (!treeData) {
        // Keep minimap at default width when empty.
        graphBodyRef.current?.style.setProperty('grid-template-columns', `${miniW}px 1fr`)
        graphBodyRef.current?.style.setProperty('--minimapW', `${miniW}px`)
        miniSvg.attr('viewBox', `0 0 ${miniW} ${miniH}`)

        miniSvg
          .append('text')
          .attr('x', 8)
          .attr('y', 16)
          .attr('fill', 'rgba(255,255,255,0.6)')
          .attr('font-size', 11)
          //.text('Map')

        svg
          .append('text')
          .attr('x', 16)
          .attr('y', 22)
          .attr('fill', 'rgba(255,255,255,0.75)')
          .attr('font-size', 13)
          .text('Upload a CSV and pick a path column to render the folder tree.')
        return
      }

      const hidden = hiddenFolderPaths
      const filterTree = (node: FileTreeNode): FileTreeNode | null => {
        if (node.path !== 'root' && hidden.length && isAtOrDownstreamOfAnyFolderPath(node.path, hidden)) return null
        const kids = node.children ?? []
        if (!kids.length) return { ...node }
        const nextKids = kids.map(filterTree).filter((v): v is FileTreeNode => Boolean(v))
        return { ...node, children: nextKids }
      }

      const visibleTreeData = filterTree(treeData)
      if (!visibleTreeData) {
        svg
          .append('text')
          .attr('x', 16)
          .attr('y', 22)
          .attr('fill', 'rgba(255,255,255,0.75)')
          .attr('font-size', 13)
          .text('All folders are hidden. Unhide some folders to see the graph.')
        return
      }

      const deviceSet = new Set(devicePaths)
      const mergedDeviceSet = new Set(mergedDevicePaths)

      const g = svg.append('g')

      // This gets replaced once the minimap elements exist.
      let updateMiniViewport = (_t: d3.ZoomTransform) => {}

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 4])
        .clickDistance(6)
        .filter((event) => {
          // While box-selecting (or when Shift is held), disable zoom/pan.
          if (isBoxSelecting) return false
          // Cmd/Ctrl is reserved for multi-select/box-select.
          if (isMultiSelectModifier(event)) return false

          const e = (event as any).sourceEvent ?? event
          if (e?.type === 'wheel') return true

          // Don't start pan/zoom gestures when interacting with nodes.
          const target = (e?.target ?? null) as Element | null
          if (target?.closest?.('.treeNode')) return false

          return true
        })
        .on('zoom', (event) => {
          currentZoomTransform = event.transform
          g.attr('transform', event.transform)
          zoomTransformRef.current = event.transform
          updateMiniViewport(event.transform)
        })

      svg.call(zoom)

      // Re-apply the previous transform so selection updates don't "jump" the view.
      svg.call(zoom.transform, zoomTransformRef.current)
      currentZoomTransform = zoomTransformRef.current

      // Horizontal tree: root at left, depth increases to the right.
      const root = d3.hierarchy<FileTreeNode>(visibleTreeData, (d) => d.children)

      const margin = { top: 20, right: 20, bottom: 20, left: 20 }
      const innerW = Math.max(1, w - margin.left - margin.right)
      const innerH = Math.max(1, h - margin.top - margin.bottom)

      // Vertical spacing per node and horizontal spacing per depth.
      const dx = 22
      const dy = Math.max(120, innerW / Math.max(1, root.height + 1))

      const treeLayout = d3.tree<FileTreeNode>().nodeSize([dx, dy])
      const pointRoot = treeLayout(root) as unknown as d3.HierarchyPointNode<FileTreeNode>

      // Center vertically.
      const x0 = d3.min(pointRoot.descendants(), (d) => d.x) ?? 0
      const x1 = d3.max(pointRoot.descendants(), (d) => d.x) ?? 0
      const y1 = d3.max(pointRoot.descendants(), (d) => d.y) ?? 0

      const xPad = (innerH - (x1 - x0)) / 2
      const yPad = 0

      const gg = g.append('g').attr('transform', `translate(${margin.left + yPad},${margin.top + xPad - x0})`)

      // --- Minimap (overview) ---
      // World coordinates (before zoom) for nodes/links.
      const ggTranslateX = margin.left + yPad
      const ggTranslateY = margin.top + xPad - x0

      const toWorld = (d: d3.HierarchyPointNode<FileTreeNode>) => ({
        wx: ggTranslateX + d.y,
        wy: ggTranslateY + d.x,
      })

      const allNodes = pointRoot.descendants()
      const nodeByPath = new Map<string, d3.HierarchyPointNode<FileTreeNode>>()
      const worldXs: number[] = []
      const worldYs: number[] = []
      for (const d of allNodes) {
        nodeByPath.set(d.data.path, d)
        const { wx, wy } = toWorld(d)
        worldXs.push(wx)
        worldYs.push(wy)
      }

      // Precompute subtree vertical bounds (in layout-x space) for every node.
      // This allows device subtree extents in O(1) per device, after an O(N) pass.
      const subtreeXBounds = new WeakMap<d3.HierarchyPointNode<FileTreeNode>, { minX: number; maxX: number }>()
      for (const d of [...allNodes].reverse()) {
        let minX = d.x
        let maxX = d.x
        const kids = d.children ?? []
        for (const k of kids) {
          const b = subtreeXBounds.get(k)
          if (!b) continue
          if (b.minX < minX) minX = b.minX
          if (b.maxX > maxX) maxX = b.maxX
        }
        subtreeXBounds.set(d, { minX, maxX })
      }

      const minWX = d3.min(worldXs) ?? 0
      const maxWX = d3.max(worldXs) ?? 1
      const minWY = d3.min(worldYs) ?? 0
      const maxWY = d3.max(worldYs) ?? 1

      const pad = 8
      const spanX = Math.max(1e-6, maxWX - minWX)
      const spanY = Math.max(1e-6, maxWY - minWY)

      // Fit-to-height: choose a minimap width that would allow the entire graph
      // bounds to fit vertically (like VS Code's minimap), clamped to a safe range.
      const MINIMAP_MIN_W = 90
      const MINIMAP_MAX_W = 220
      const heightScale = (miniH - pad * 2) / spanY
      const idealMiniW = pad * 2 + spanX * heightScale
      const clampedMiniW = Math.max(MINIMAP_MIN_W, Math.min(MINIMAP_MAX_W, idealMiniW))
      if (Number.isFinite(clampedMiniW) && Math.abs(clampedMiniW - minimapWidthRef.current) > 0.5) {
        minimapWidthRef.current = clampedMiniW
      }
      miniW = minimapWidthRef.current

      graphBodyRef.current?.style.setProperty('grid-template-columns', `${miniW}px 1fr`)
      graphBodyRef.current?.style.setProperty('--minimapW', `${miniW}px`)
      miniSvg.attr('viewBox', `0 0 ${miniW} ${miniH}`).attr('overflow', 'visible')

      const s = Math.min((miniW - pad * 2) / spanX, (miniH - pad * 2) / spanY)

      const mapX = (wx: number) => pad + (wx - minWX) * s
      const mapY = (wy: number) => pad + (wy - minWY) * s

      const miniG = miniSvg.append('g')
      miniG
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', miniW)
        .attr('height', miniH)
        .attr('fill', 'rgba(12, 22, 40, 0.6)')

      // Links
      miniG
        .append('g')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.14)')
        .attr('stroke-width', 1)
        .selectAll('line')
        .data(pointRoot.links())
        .join('line')
        .attr('x1', (d) => mapX(toWorld(d.source).wx))
        .attr('y1', (d) => mapY(toWorld(d.source).wy))
        .attr('x2', (d) => mapX(toWorld(d.target).wx))
        .attr('y2', (d) => mapY(toWorld(d.target).wy))

      // Nodes (minimal)
      miniG
        .append('g')
        .selectAll('circle')
        .data(allNodes)
        .join('circle')
        .attr('cx', (d) => mapX(toWorld(d).wx))
        .attr('cy', (d) => mapY(toWorld(d).wy))
        .attr('r', 1.6)
        .attr('fill', 'rgba(255,255,255,0.45)')

      const viewportRect = miniG
        .append('rect')
        .attr('class', 'minimapViewport')
        .attr('fill', 'rgba(96,165,250,0.10)')
        .attr('stroke', 'rgba(96,165,250,0.75)')
        .attr('stroke-width', 1)
        .attr('rx', 6)
        .attr('ry', 6)

      // Device coverage bars (union of device subtrees), rendered as vertical segments
      // along the right edge of the minimap.
      const deviceIntervals: Array<[number, number]> = []
      if (devicePaths.length) {
        const MIN_BAR_H = 5
        for (const p of devicePaths) {
          const n = nodeByPath.get(p)
          if (!n) continue
          const b = subtreeXBounds.get(n)
          if (!b) continue

          const wy0 = ggTranslateY + b.minX
          const wy1 = ggTranslateY + b.maxX
          let y0 = mapY(Math.min(wy0, wy1))
          let y1 = mapY(Math.max(wy0, wy1))

          if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue

          // If the device subtree is a single node (leaf folder), make it visible.
          if (y1 - y0 < MIN_BAR_H) {
            const mid = (y0 + y1) / 2
            y0 = mid - MIN_BAR_H / 2
            y1 = mid + MIN_BAR_H / 2
          }

          deviceIntervals.push([Math.max(0, y0), Math.min(miniH, y1)])
        }
      }

      const mergedDeviceIntervals: Array<[number, number]> = []
      if (deviceIntervals.length) {
        deviceIntervals.sort((a, b) => a[0] - b[0])
        const MERGE_GAP_PX = 1.5
        let [cs, ce] = deviceIntervals[0]
        for (let i = 1; i < deviceIntervals.length; i++) {
          const [s0, e0] = deviceIntervals[i]
          if (s0 <= ce + MERGE_GAP_PX) {
            ce = Math.max(ce, e0)
          } else {
            mergedDeviceIntervals.push([cs, ce])
            cs = s0
            ce = e0
          }
        }
        mergedDeviceIntervals.push([cs, ce])
      }

      if (mergedDeviceIntervals.length) {
        const barW = 8
        miniG
          .append('g')
          .attr('class', 'minimapDeviceBars')
          .selectAll('rect')
          .data(mergedDeviceIntervals)
          .join('rect')
          .attr('x', miniW - barW / 2)
          .attr('y', (d) => d[0])
          .attr('width', barW)
          .attr('height', (d) => Math.max(0, d[1] - d[0]))
          .attr('fill', 'rgba(52, 211, 153, 0.9)')
          .attr('stroke', 'rgba(16, 185, 129, 0.95)')
          .attr('stroke-width', 1)
          .attr('rx', 3)
          .attr('ry', 3)
      }

      // Expose a lightweight "pan to folder" action for the stats button.
      navigateToFolderRef.current = (folderPath: string) => {
        const node = nodeByPath.get(folderPath)
        if (!node) return false
        const { wx, wy } = toWorld(node)
        const k = currentZoomTransform.k
        const next = d3.zoomIdentity.translate(w / 2 - k * wx, h / 2 - k * wy).scale(k)
        svg.call(zoom.transform as any, next)
        return true
      }

      updateMiniViewport = (t: d3.ZoomTransform) => {
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

        const wx0 = t.invertX(0)
        const wy0 = t.invertY(0)
        const wx1 = t.invertX(w)
        const wy1 = t.invertY(h)

        const x0 = clamp(mapX(Math.min(wx0, wx1)), 0, miniW)
        const y0 = clamp(mapY(Math.min(wy0, wy1)), 0, miniH)
        const x1 = clamp(mapX(Math.max(wx0, wx1)), 0, miniW)
        const y1 = clamp(mapY(Math.max(wy0, wy1)), 0, miniH)

        viewportRect
          .attr('x', x0)
          .attr('y', y0)
          .attr('width', Math.max(0, x1 - x0))
          .attr('height', Math.max(0, y1 - y0))
      }

      // Initial viewport box.
      updateMiniViewport(currentZoomTransform)

      // Minimap interaction: click/drag to pan main view.
      let isMiniDragging = false
      const setCenterFromMini = (mx: number, my: number) => {
        if (!Number.isFinite(s) || s <= 0) return
        const worldX = minWX + (mx - pad) / s
        const worldY = minWY + (my - pad) / s
        const k = currentZoomTransform.k
        const next = d3.zoomIdentity.translate(w / 2 - k * worldX, h / 2 - k * worldY).scale(k)
        svg.call(zoom.transform as any, next)
      }

      miniSvg
        .style('touch-action', 'none')
        .on('pointerdown.mini', (event) => {
          const e = event as PointerEvent
          if (e.button !== 0) return
          isMiniDragging = true
          const [mx, my] = d3.pointer(e, miniSvg.node() as any)
          setCenterFromMini(mx, my)
        })
        .on('pointermove.mini', (event) => {
          if (!isMiniDragging) return
          const e = event as PointerEvent
          const [mx, my] = d3.pointer(e, miniSvg.node() as any)
          setCenterFromMini(mx, my)
        })
        .on('pointerup.mini pointercancel.mini', () => {
          isMiniDragging = false
        })

      // Box selection overlay (Shift-drag). Coordinates are in SVG space.
      const box = svg
        .append('rect')
        .attr('fill', 'rgba(96,165,250,0.15)')
        .attr('stroke', 'rgba(96,165,250,0.55)')
        .attr('stroke-width', 1)
        .attr('rx', 6)
        .attr('ry', 6)
        .style('display', 'none')

      const pointInRect = (sx: number, sy: number, r: [[number, number], [number, number]]) => {
        const xMin = Math.min(r[0][0], r[1][0])
        const xMax = Math.max(r[0][0], r[1][0])
        const yMin = Math.min(r[0][1], r[1][1])
        const yMax = Math.max(r[0][1], r[1][1])
        return sx >= xMin && sx <= xMax && sy >= yMin && sy <= yMax
      }

      const computeScreenPos = (d: d3.HierarchyPointNode<FileTreeNode>) => {
        const localX = ggTranslateX + d.y
        const localY = ggTranslateY + d.x
        return {
          sx: currentZoomTransform.applyX(localX),
          sy: currentZoomTransform.applyY(localY),
        }
      }

      const computePickedFromRect = (rect: [[number, number], [number, number]]): Set<string> => {
        const picked = new Set<string>()
        for (const d of pointRoot.descendants()) {
          const { sx, sy } = computeScreenPos(d)
          if (pointInRect(sx, sy, rect)) picked.add(d.data.path)
        }
        return picked
      }

      let selectionRing:
        | d3.Selection<SVGCircleElement, d3.HierarchyPointNode<FileTreeNode>, SVGGElement, unknown>
        | null = null

      const updateSelectionRings = (visibleSet: Set<string>) => {
        if (!selectionRing) return
        selectionRing.style('display', (d) => (visibleSet.has(d.data.path) ? null : 'none'))
      }

      const finishBoxSelect = () => {
        if (!isBoxSelecting || !boxStart) return

        const x = Number(box.attr('x'))
        const y = Number(box.attr('y'))
        const bw = Number(box.attr('width'))
        const bh = Number(box.attr('height'))
        const rect: [[number, number], [number, number]] = [
          [x, y],
          [x + bw, y + bh],
        ]

        const picked = previewPicked.size ? previewPicked : computePickedFromRect(rect)

        const merged = new Set(baseSelection ?? selectedPaths)
        for (const p of picked) merged.add(p)
        updateSelectionRings(merged)
        onSetSelection(Array.from(merged))

        box.style('display', 'none')
        isBoxSelecting = false
        boxStart = null
        baseSelection = null
        previewPicked = new Set()
        pendingRect = null
        if (rafId != null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
      }

      // Shift + drag on background to box-select.
      // Note: we attach to the SVG itself, so nodes remain clickable.
      svg
        .on('click.clear', (event) => {
          if (isBoxSelecting) return
          // Cmd/Ctrl-click should not clear selection.
          if (isMultiSelectModifier(event)) return
          const target = (event.target ?? null) as Element | null
          if (target?.closest?.('.treeNode')) return
          onSetSelection([])
        })
        .on('pointerdown.box', (event) => {
          const e = event as PointerEvent
          if (e.button !== 0) return

          const target = e.target as Element | null
          const isBackground = target?.tagName?.toLowerCase() === 'svg'
          if (!isMultiSelectModifier(e) || !isBackground) return

          e.preventDefault()
          e.stopPropagation()

          isBoxSelecting = true
          baseSelection = new Set(selectedPaths)
          previewPicked = new Set()
          boxStart = d3.pointer(e, svg.node() as any)
          box
            .style('display', null)
            .attr('x', boxStart[0])
            .attr('y', boxStart[1])
            .attr('width', 0)
            .attr('height', 0)
        })
        .on('pointermove.box', (event) => {
          if (!isBoxSelecting || !boxStart) return
          const e = event as PointerEvent
          const [sx, sy] = d3.pointer(e, svg.node() as any)
          const x = Math.min(boxStart[0], sx)
          const y = Math.min(boxStart[1], sy)
          const bw = Math.abs(boxStart[0] - sx)
          const bh = Math.abs(boxStart[1] - sy)
          box.attr('x', x).attr('y', y).attr('width', bw).attr('height', bh)

          pendingRect = [
            [x, y],
            [x + bw, y + bh],
          ]

          if (rafId == null) {
            rafId = requestAnimationFrame(() => {
              rafId = null
              if (!isBoxSelecting || !pendingRect) return
              const picked = computePickedFromRect(pendingRect)
              previewPicked = picked
              const visible = new Set(baseSelection ?? selectedSet)
              for (const p of picked) visible.add(p)
              updateSelectionRings(visible)
            })
          }
        })
        .on('pointerup.box', () => {
          finishBoxSelect()
        })
        .on('pointercancel.box', () => {
          // Cancel should not change selection; just clear preview.
          box.style('display', 'none')
          isBoxSelecting = false
          boxStart = null
          pendingRect = null
          previewPicked = new Set()
          if (rafId != null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          updateSelectionRings(baseSelection ?? selectedSet)
          baseSelection = null
        })

      const linkGen = d3
        .linkHorizontal<d3.HierarchyPointLink<FileTreeNode>, d3.HierarchyPointNode<FileTreeNode>>()
        .x((d) => d.y)
        .y((d) => d.x)

      gg
        .append('g')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.22)')
        .attr('stroke-width', 1)
        .selectAll('path')
        .data(pointRoot.links())
        .join('path')
        .attr('d', (d) => linkGen(d) ?? '')

      const nodeG = gg
        .append('g')
        .selectAll<SVGGElement, d3.HierarchyPointNode<FileTreeNode>>('g')
        .data(pointRoot.descendants())
        .join('g')
        .attr('class', 'treeNode')
        .attr('transform', (d) => `translate(${d.y},${d.x})`)

      nodeG
        .style('cursor', 'pointer')
        .on('pointerdown', (event) => {
          // Prevent d3-zoom from interpreting a click on a node as the start of a pan gesture.
          event.stopPropagation()
        })
        .on('click', (event, d) => {
          // If we were box-selecting, ignore click noise.
          if (isBoxSelecting) return
          event.stopPropagation()
          if (isMultiSelectModifier(event)) onToggleSelected(d.data.path)
          else onSelectSingle(d.data.path)
        })

      // Selection ring (drawn behind the node circle). Always present so we can preview box-select live.
      selectionRing = nodeG
        .append('circle')
        .attr('r', 9)
        .attr('fill', 'rgba(96,165,250,0.12)')
        .attr('stroke', 'rgba(96,165,250,0.8)')
        .attr('stroke-width', 2)
        .style('display', (d) => (selectedSet.has(d.data.path) ? null : 'none'))

      nodeG
        .append('circle')
        .attr('r', 5)
        .attr('fill', (d) => {
          if (deviceSet.has(d.data.path)) return mergedDeviceSet.has(d.data.path) ? '#ff4db8' : '#34d399'
          if (isDownstreamOfAnyFolderPath(d.data.path, devicePaths)) return '#94a3b8'
          return '#60a5fa'
        })
        .attr('opacity', (d) => {
          if (deviceSet.has(d.data.path)) return 1
          return isDownstreamOfAnyFolderPath(d.data.path, devicePaths) ? 0.4 : 1
        })
        .attr('stroke', 'rgba(255,255,255,0.75)')
        .attr('stroke-width', 1)

      nodeG
        .append('text')
        .attr('x', 10)
        .attr('y', 0)
        .attr('dominant-baseline', 'middle')
        .attr('fill', (d) => {
          if (deviceSet.has(d.data.path)) return mergedDeviceSet.has(d.data.path) ? 'rgba(255,77,184,0.95)' : 'rgba(52,211,153,0.95)'
          if (isDownstreamOfAnyFolderPath(d.data.path, devicePaths)) return 'rgba(148,163,184,0.9)'
          return 'rgba(255,255,255,0.88)'
        })
        .attr('opacity', (d) => {
          if (deviceSet.has(d.data.path)) return 1
          return isDownstreamOfAnyFolderPath(d.data.path, devicePaths) ? 0.4 : 1
        })
        .attr('font-size', 12)
        .text((d) => d.data.name)

      // Hint: show rough bounds for debugging large trees.
      gg
        .append('text')
        .attr('x', 0)
        .attr('y', -10)
        .attr('fill', 'rgba(255,255,255,0.55)')
        .attr('font-size', 11)
        .text(
          `Folders: ${pointRoot.descendants().length} • Depth: ${pointRoot.height} • Width: ${Math.round(y1)}px`,
        )
    }

    const ro = new ResizeObserver(() => {
      render()
    })
    ro.observe(wrapper)

    render()

    return () => {
      ro.disconnect()
    }
  }, [
    treeData,
    devicePaths,
    mergedDevicePaths,
    hiddenFolderPaths,
    selectedPaths,
    totalPointsCount,
    unassignedPointsCount,
    unassignedFolderPaths,
    onSelectSingle,
    onToggleSelected,
    onSetSelection,
  ])

  const visibleUnassigned = hiddenFolderPaths.length
    ? unassignedFolderPaths.filter((p) => !isAtOrDownstreamOfAnyFolderPath(p, hiddenFolderPaths))
    : unassignedFolderPaths

  const goToNextUnassigned = () => {
    const list = visibleUnassigned
    if (!list.length) return

    const nav = navigateToFolderRef.current
    if (!nav) return

    const start = nextUnassignedIndexRef.current % list.length
    for (let i = 0; i < list.length; i++) {
      const idx = (start + i) % list.length
      const ok = nav(list[idx]!)
      if (ok) {
        nextUnassignedIndexRef.current = idx + 1
        return
      }
    }
  }

  const toggleHiddenExpanded = (path: string) => {
    setHiddenExpandedKeys((prev) => {
      const s = new Set(prev)
      if (s.has(path)) s.delete(path)
      else s.add(path)
      return Array.from(s)
    })
  }

  const toggleHiddenTypeGroup = (parentPath: string, type: string) => {
    const key = hiddenTypeKey(parentPath, type)
    setHiddenCollapsedTypeKeys((prev) => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return Array.from(s)
    })
  }

  const toggleHiddenChecked = (path: string) => {
    setHiddenChecked((prev) => {
      const s = new Set(prev)
      if (s.has(path)) s.delete(path)
      else s.add(path)
      return Array.from(s)
    })
  }

  const hiddenCheckedCount = hiddenChecked.length
  const hiddenAllChecked = sortedHidden.length > 0 && hiddenCheckedCount === sortedHidden.length
  const hiddenSomeChecked = hiddenCheckedCount > 0 && !hiddenAllChecked

  const toggleHiddenSelectAll = () => {
    if (!sortedHidden.length) return
    setHiddenChecked(hiddenAllChecked ? [] : [...sortedHidden])
  }

  const unhideChecked = () => {
    if (!hiddenChecked.length) return
    const toUnhide = [...hiddenChecked]
    setHiddenChecked([])
    setHiddenExpandedKeys((prev) => prev.filter((p) => !new Set(toUnhide).has(p)))
    onUnhideHiddenFolders(toUnhide)
  }

  return (
    <div ref={wrapperRef} className="graphWrapper">
      <div className="graphHeader">
        <div className="graphControls">
          <label className="fileButton">
            Choose CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUploadCsv(file)
                e.currentTarget.value = ''
              }}
            />
          </label>

          <select
            className="graphSelect"
            value={selectedColumn}
            disabled={!columns.length}
            onChange={(e) => onSelectColumn(e.target.value)}
          >
            <option value="" disabled>
              {columns.length ? 'Select column…' : 'Upload CSV first'}
            </option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="graphSelect"
            value={selectedTypeColumn}
            disabled={!columns.length || !selectedColumn}
            onChange={(e) => onSelectTypeColumn(e.target.value)}
          >
            <option value="">No type column</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="graphButtonGroupRight">
            <button className="graphIconButton" type="button" onClick={onOpenHelp} aria-label="Open instructions">
              <Info size={18} />
            </button>
            <button
              className="graphButton success"
              type="button"
              onClick={onExportCsv}
              disabled={exportDisabled}
              title={exportDisabled ? 'Upload a CSV and select a path column first' : 'Export CSV with device_name column'}
            >
              Export
            </button>
          </div>
        </div>
      </div>
      <div ref={graphBodyRef} className="graphBody">
        <div className="minimapPane">
          <div className="minimapMap">
            <svg ref={miniRef} className="minimapSvg" role="img" aria-label="Overview map" />
          </div>
          <div
            className={`minimapStats${statsReady ? '' : ' minimapStatsEmpty'}`}
            aria-label={statsReady ? 'Progress stats' : 'Progress stats (empty)'}
          >
            {statsReady ? (
              <>
                <div className="miniStatBlock">
                  <div className="miniStatValue">{deviceCount}</div>
                  <div className="miniStatLabel">Devices</div>
                </div>

                <div className="miniStatBlock">
                  <div className="miniStatValue">
                    {unassignedPointsCount}/{totalPointsCount} ({unassignedPct}%)
                  </div>
                  <div className="miniStatLabel">Unassigned</div>
                </div>
              </>
            ) : null}
          </div>
        </div>
        <svg ref={svgRef} className="graphSvg" role="img" aria-label="D3 graph" />

        <button
          className="graphButton graphJumpFloating"
          type="button"
          onClick={goToNextUnassigned}
          disabled={!statsReady || !visibleUnassigned.length}
          title={
            !statsReady
              ? 'Upload a CSV and select a path column first'
              : visibleUnassigned.length
                ? 'Pan to the next unassigned folder'
                : 'All points are assigned'
          }
        >
          Jump to next unassigned
        </button>

        <div
          className={hiddenOpen ? 'hiddenOverlay expanded' : 'hiddenOverlay'}
          role="region"
          aria-label="Hidden nodes"
        >
          <div className="hiddenOverlayHeader">
            <div className="hiddenOverlayTitleRow">
              <button
                className="hiddenOverlayToggle"
                type="button"
                onClick={() => {
                  setHiddenOpen((v) => {
                    const next = !v
                    if (!next) setHiddenChecked([])
                    return next
                  })
                }}
                aria-label={hiddenOpen ? 'Collapse hidden nodes panel' : 'Expand hidden nodes panel'}
                title={hiddenOpen ? 'Collapse' : 'Expand'}
              >
                {hiddenOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
              </button>
              <div className="hiddenOverlayTitle">Hidden nodes</div>
              <div className="hiddenOverlayCount">{sortedHidden.length}</div>
            </div>

            <div className="hiddenOverlayActions">
              <button
                className="devicesHeaderButton prune"
                type="button"
                disabled={!hiddenCheckedCount}
                onClick={unhideChecked}
                aria-label={hiddenCheckedCount ? 'Unhide selected nodes' : 'Unhide selected nodes (disabled)'}
                title={
                  hiddenCheckedCount
                    ? hiddenCheckedCount === 1
                      ? 'Unhide selected node'
                      : `Unhide ${hiddenCheckedCount} selected nodes`
                    : 'Select hidden nodes to unhide'
                }
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
          </div>

          {hiddenOpen ? (
            sortedHidden.length === 0 ? (
              <div className="hiddenOverlayEmpty" aria-label="Hidden nodes list">
                No hidden folders yet.
              </div>
            ) : (
              <ul className="deviceList hiddenOverlayBody" aria-label="Hidden nodes list">
                <li className="deviceItem deviceSelectAllItem">
                  <div className="selectAllRow">
                    <label
                      className="deviceSelect"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <input
                        className="deviceCheckbox"
                        type="checkbox"
                        checked={hiddenAllChecked}
                        ref={(el) => {
                          if (!el) return
                          el.indeterminate = hiddenSomeChecked
                        }}
                        onChange={toggleHiddenSelectAll}
                        aria-label={hiddenAllChecked ? 'Deselect all hidden nodes' : 'Select all hidden nodes'}
                      />
                    </label>
                    <span className="selectAllMeta" aria-label={`${hiddenCheckedCount} selected out of ${sortedHidden.length}`}>
                      {hiddenCheckedCount}/{sortedHidden.length}
                    </span>
                  </div>
                </li>

                {sortedHidden.map((p) => {
                  const isExpanded = hiddenExpandedSet.has(p)
                  const isChecked = hiddenCheckedSet.has(p)
                  const shown = displayPath(p)
                  const raw = shown.split('/').pop() ?? shown
                  const name = decodeStandardName(raw)

                  const groups = listLeafPointsUnderFolderByType(p, points)
                  const union = new Set<string>()
                  for (const g of groups) for (const pt of g.points) union.add(pt)
                  const pointCount = union.size

                  return (
                    <li key={p} className={isExpanded ? 'deviceItem open' : 'deviceItem'}>
                      <div className="cardRow">
                        <label
                          className="deviceSelect"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <input
                            className="deviceCheckbox"
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleHiddenChecked(p)}
                            aria-label={isChecked ? `Deselect ${name}` : `Select ${name}`}
                          />
                        </label>

                        <div
                          className="cardToggle"
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleHiddenExpanded(p)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleHiddenExpanded(p)
                            }
                          }}
                          aria-expanded={isExpanded}
                        >
                          <span className="cardMain">
                            <span className="nodeBadgeWrap halo grey" aria-hidden>
                              <span className="nodeBadge grey" />
                            </span>

                            <span className="cardLeft">
                              <span className="deviceName" title={name}>
                                {name}
                              </span>
                              <span className="devicePath" title={shown}>
                                {shown}
                              </span>
                            </span>
                          </span>

                          <span className="cardRight" aria-label={`${pointCount} points`}>
                            <span className="cardMeta">{pointCount} points</span>
                            <svg className="chevronIcon" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                              <path
                                d="M6 4l4 4-4 4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="cardDetails">
                          {groups.length === 0 ? (
                            <div className="cardEmpty">No points found under this folder.</div>
                          ) : (
                            <ul className="typeGroupList" role="list" aria-label="Point types">
                              {groups.map((g) => {
                                const groupOpen = !hiddenTypeCollapsedSet.has(hiddenTypeKey(p, g.type))
                                return (
                                  <li key={g.type} className={groupOpen ? 'typeGroupItem open' : 'typeGroupItem'}>
                                    <button
                                      className="typeGroupToggle"
                                      type="button"
                                      onClick={() => toggleHiddenTypeGroup(p, g.type)}
                                      aria-expanded={groupOpen}
                                    >
                                      <span className="typeGroupLeft" title={g.type}>
                                        <span className="typeGroupName">{g.type}</span>
                                      </span>
                                      <span className="typeGroupRight" aria-label={`${g.points.length} points`}>
                                        <span className="typeGroupMeta">{g.points.length}</span>
                                        <svg className="chevronIcon" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                                          <path
                                            d="M6 4l4 4-4 4"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        </svg>
                                      </span>
                                    </button>

                                    {groupOpen ? (
                                      <div className="typeGroupDetails">
                                        <ul className="pointTypeList">
                                          {g.points.map((pt) => (
                                            <li key={pt} className="pointItem" title={pt}>
                                              {pt}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}
                                  </li>
                                )
                              })}
                            </ul>
                          )}

                          <div className="hiddenOverlayHint">Exports hidden points with device_name = “-”.</div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
