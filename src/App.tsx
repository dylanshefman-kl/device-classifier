import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import Graph from './components/Graph'
import Devices from './components/Devices'
import Sidebar from './components/Sidebar'
import type { FileTreeNode } from './lib/fileTree'
import { buildFolderTreeFromPaths } from './lib/fileTree'
import type { PointRecord } from './lib/fileTree'
import { getPathRelation } from './lib/fileTree'
import { decodeStandardName } from './lib/fileTree'
import { isAtOrDownstreamOfAnyFolderPath } from './lib/fileTree'

type ReassignmentGroup = {
  fromDevicePath: string | null
  toDevicePath: string | null
  pointPaths: string[]
}

type PendingDeviceConflict = {
  toAdd: string[]
  toRemove: string[]
  droppedFromSelection: string[]
  upstreamConflicts: string[]
  downstreamConflicts: string[]
  reassignmentGroups: ReassignmentGroup[]
}

type MergedDevice = {
  id: string
  name: string
  memberPaths: string[]
}

type PendingMerge = {
  memberPaths: string[]
  suggestedName: string
}

export default function App() {
  const [csvText, setCsvText] = useState<string | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [selectedColumn, setSelectedColumn] = useState<string>('')
  const [selectedTypeColumn, setSelectedTypeColumn] = useState<string>('')
  const [paths, setPaths] = useState<string[]>([])
  const [points, setPoints] = useState<PointRecord[]>([])
  const [devicePaths, setDevicePaths] = useState<string[]>([])
  const [mergedDevices, setMergedDevices] = useState<MergedDevice[]>(() => {
    try {
      const raw = localStorage.getItem('device.mergedDevices')
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      const out: MergedDevice[] = []
      for (const item of parsed) {
        const obj = item as any
        const id = typeof obj?.id === 'string' ? obj.id : ''
        const name = typeof obj?.name === 'string' ? obj.name.trim() : ''
        const memberPaths = Array.isArray(obj?.memberPaths) ? obj.memberPaths.filter((p: any) => typeof p === 'string') : []
        if (!id || !name || memberPaths.length === 0) continue
        out.push({ id, name, memberPaths })
      }
      return out
    } catch {
      return []
    }
  })
  const [deviceNameByPath, setDeviceNameByPath] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('device.nameByPath')
      if (!raw) return {}
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof k !== 'string') continue
        if (typeof v !== 'string') continue
        const trimmed = v.trim()
        if (!trimmed) continue
        out[k] = trimmed
      }
      return out
    } catch {
      return {}
    }
  })
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [hiddenFolderPaths, setHiddenFolderPaths] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('tree.hiddenFolderPaths')
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    } catch {
      return []
    }
  })
  const [pendingConflict, setPendingConflict] = useState<PendingDeviceConflict | null>(null)
  const [openReassignGroups, setOpenReassignGroups] = useState<Record<string, boolean>>({})
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null)
  const [mergeName, setMergeName] = useState('')

  const shellRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<
    | null
    | {
        axis: 'x' | 'y'
        startClient: number
        startSplit: number
      }
  >(null)

  const [splitX, setSplitX] = useState<number | null>(() => {
    const raw = localStorage.getItem('layout.splitX')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  })

  const [splitY, setSplitY] = useState<number | null>(() => {
    const raw = localStorage.getItem('layout.splitY')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  })

  const [isDraggingX, setIsDraggingX] = useState(false)
  const [isDraggingY, setIsDraggingY] = useState(false)

  const displayDevicePath = useCallback((p: string) => (p.startsWith('root/') ? p.slice('root/'.length) : p), [])

  const mergedNameByPath = useMemo(() => {
    const m = new Map<string, string>()
    for (const md of mergedDevices) {
      const name = md.name.trim()
      if (!name) continue
      for (const p of md.memberPaths) m.set(p, name)
    }
    return m
  }, [mergedDevices])

  const mergedDevicePaths = useMemo(() => Array.from(mergedNameByPath.keys()), [mergedNameByPath])

  const deviceEntityCount = useMemo(() => {
    let unmerged = 0
    for (const p of devicePaths) if (!mergedNameByPath.has(p)) unmerged++
    return mergedDevices.length + unmerged
  }, [devicePaths, mergedDevices.length, mergedNameByPath])

  const displayDeviceName = useCallback(
    (p: string) => {
      const mergedName = mergedNameByPath.get(p)
      if (mergedName && mergedName.trim()) return mergedName.trim()
      const override = deviceNameByPath[p]
      if (override && override.trim()) return override.trim()
      const shown = displayDevicePath(p)
      const raw = shown.split('/').pop() ?? shown
      return decodeStandardName(raw)
    },
    [deviceNameByPath, displayDevicePath, mergedNameByPath],
  )

  const renameDevice = useCallback((path: string, nextName: string) => {
    const trimmed = nextName.trim()
    setDeviceNameByPath((prev) => {
      const out = { ...prev }
      if (!trimmed) {
        delete out[path]
        return out
      }
      out[path] = trimmed
      return out
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('device.nameByPath', JSON.stringify(deviceNameByPath))
    } catch {
      // ignore
    }
  }, [deviceNameByPath])

  useEffect(() => {
    try {
      localStorage.setItem('device.mergedDevices', JSON.stringify(mergedDevices))
    } catch {
      // ignore
    }
  }, [mergedDevices])

  useEffect(() => {
    // Prune merged groups if their member paths are no longer devices.
    setMergedDevices((prev) => {
      const deviceSet = new Set(devicePaths)
      let changed = false
      const next: MergedDevice[] = []
      for (const md of prev) {
        const kept = md.memberPaths.filter((p) => deviceSet.has(p))
        if (kept.length === 0) {
          changed = true
          continue
        }
        if (kept.length !== md.memberPaths.length) changed = true
        next.push({ ...md, memberPaths: kept })
      }
      return changed ? next : prev
    })
  }, [devicePaths])

  useEffect(() => {
    // Prune overrides for removed devices.
    setDeviceNameByPath((prev) => {
      const deviceSet = new Set(devicePaths)
      let changed = false
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (!deviceSet.has(k)) {
          changed = true
          continue
        }
        out[k] = v
      }
      return changed ? out : prev
    })
  }, [devicePaths])

  const treeData: FileTreeNode | null = useMemo(() => {
    if (!paths.length) return null
    return buildFolderTreeFromPaths(paths, 'root')
  }, [paths])

  const treeFolderPathSet = useMemo(() => {
    const set = new Set<string>()
    if (!treeData) return set
    const rec = (n: FileTreeNode) => {
      set.add(n.path)
      n.children?.forEach(rec)
    }
    rec(treeData)
    return set
  }, [treeData])

  const normalizeHiddenFolderPaths = useCallback((incoming: string[]): string[] => {
    const unique = Array.from(new Set(incoming.map((p) => p.trim()).filter(Boolean)))
    const candidates = unique
      .filter((p) => p !== 'root')
      .filter((p) => (treeFolderPathSet.size ? treeFolderPathSet.has(p) : true))

    // Keep only the most-general paths (drop descendants of other hidden paths).
    const kept: string[] = []
    for (const p of candidates.sort((a, b) => a.localeCompare(b))) {
      let covered = false
      for (const other of candidates) {
        if (p === other) continue
        const rel = getPathRelation(other, p)
        if (rel === 'ancestor' || rel === 'same') {
          covered = true
          break
        }
      }
      if (!covered) kept.push(p)
    }

    return kept.sort((a, b) => a.localeCompare(b))
  }, [treeFolderPathSet])

  useEffect(() => {
    setHiddenFolderPaths((prev) => normalizeHiddenFolderPaths(prev))
  }, [normalizeHiddenFolderPaths])

  useEffect(() => {
    try {
      localStorage.setItem('tree.hiddenFolderPaths', JSON.stringify(hiddenFolderPaths))
    } catch {
      // ignore
    }
  }, [hiddenFolderPaths])

  const onUploadCsv = useCallback(async (file: File) => {
    const text = await file.text()
    setCsvText(text)

    const rows = d3.csvParse(text)
    const cols = rows.columns ?? []
    setColumns(cols)

    // Reset selection until user chooses.
    setSelectedColumn('')
    setSelectedTypeColumn('')
    setPaths([])
    setPoints([])
    setDevicePaths([])
    setSelectedPaths([])
    setHiddenFolderPaths([])
  }, [])

  const parsePointsFromCsv = useCallback(
    (text: string, pathCol: string, typeCol: string): { paths: string[]; points: PointRecord[] } => {
      const rows = d3.csvParse(text)

      const parsed: PointRecord[] = rows
        .map((r) => {
          const rec = r as Record<string, string | undefined>
          const path = (rec[pathCol] ?? '').trim()
          if (!path) return null

          const type = typeCol ? (rec[typeCol] ?? '').trim() || 'Unknown' : 'Points'

          return { path, type }
        })
        .filter((v): v is PointRecord => Boolean(v))

      return {
        paths: parsed.map((p) => p.path),
        points: parsed,
      }
    },
    [],
  )

  const onSelectColumn = useCallback(
    (col: string) => {
      setSelectedColumn(col)
      if (!csvText || !col) {
        setPaths([])
        setPoints([])
        setDevicePaths([])
        setSelectedPaths([])
        setHiddenFolderPaths([])
        return
      }

      const parsed = parsePointsFromCsv(csvText, col, selectedTypeColumn)
      setPaths(parsed.paths)
      setPoints(parsed.points)
      setDevicePaths([])
      setSelectedPaths([])
      setHiddenFolderPaths([])
    },
    [csvText, parsePointsFromCsv, selectedTypeColumn],
  )

  const onSelectTypeColumn = useCallback(
    (col: string) => {
      setSelectedTypeColumn(col)
      if (!csvText || !selectedColumn) {
        setPoints([])
        return
      }

      const parsed = parsePointsFromCsv(csvText, selectedColumn, col)
      setPaths(parsed.paths)
      setPoints(parsed.points)
    },
    [csvText, parsePointsFromCsv, selectedColumn],
  )

  const addDevices = useCallback((pathsToAdd: string[]) => {
    if (!pathsToAdd.length) return
    setDevicePaths((prev) => {
      const set = new Set(prev)
      for (const p of pathsToAdd) set.add(p)
      return Array.from(set)
    })
  }, [])

  const applyDeviceChange = useCallback((nextAdd: string[], nextRemove: string[]) => {
    setDevicePaths((prev) => {
      const removeSet = new Set(nextRemove)
      const out = new Set(prev.filter((p) => !removeSet.has(p)))
      for (const p of nextAdd) out.add(p)
      return Array.from(out)
    })
  }, [])

  const computeOwnerDevice = useCallback((pointPath: string, devices: string[]): string | null => {
    let best: { path: string; depth: number } | null = null
    for (const d of devices) {
      const rel = getPathRelation(d, pointPath)
      if (rel !== 'ancestor' && rel !== 'same') continue
      const depth = d.split('/').filter(Boolean).length
      if (!best || depth > best.depth) best = { path: d, depth }
    }
    return best?.path ?? null
  }, [])

  const unassignedStats = useMemo(() => {
    const normalize = (value: string): string => value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
    const folderKeyFromPointPath = (p: string): string | null => {
      const segs = normalize(p)
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
      if (segs.length <= 1) return null
      const folders = segs.slice(0, -1)
      if (!folders.length) return null
      if (folders[0] === 'root') return folders.join('/')
      return `root/${folders.join('/')}`
    }

    let unassigned = 0
    const folderSet = new Set<string>()
    for (const pt of points) {
      const owner = computeOwnerDevice(pt.path, devicePaths)
      if (owner != null) continue
      unassigned++
      const fk = folderKeyFromPointPath(pt.path)
      if (fk) folderSet.add(fk)
    }

    return {
      totalPointsCount: points.length,
      unassignedPointsCount: unassigned,
      unassignedFolderPaths: Array.from(folderSet).sort((a, b) => a.localeCompare(b)),
    }
  }, [computeOwnerDevice, devicePaths, points])

  const computeReassignmentGroups = useCallback(
    (currentDevices: string[], nextDevices: string[]): ReassignmentGroup[] => {
      const groupMap = new Map<string, { from: string | null; to: string | null; set: Set<string> }>()

      for (const pt of points) {
        const from = computeOwnerDevice(pt.path, currentDevices)
        const to = computeOwnerDevice(pt.path, nextDevices)

        if (from === to) continue
        // Not a problematic reassignment: previously unassigned points becoming assigned.
        if (from == null && to != null) continue
        // Also hide points becoming unassigned; not part of the overlap warning.
        if (from != null && to == null) continue

        const key = `${from ?? '∅'}→${to ?? '∅'}`
        let g = groupMap.get(key)
        if (!g) {
          g = { from, to, set: new Set<string>() }
          groupMap.set(key, g)
        }
        g.set.add(pt.path)
      }

      return Array.from(groupMap.values())
        .map((g) => ({
          fromDevicePath: g.from,
          toDevicePath: g.to,
          pointPaths: Array.from(g.set).sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => {
          const aKey = `${a.fromDevicePath ?? ''}→${a.toDevicePath ?? ''}`
          const bKey = `${b.fromDevicePath ?? ''}→${b.toDevicePath ?? ''}`
          return aKey.localeCompare(bKey)
        })
    },
    [computeOwnerDevice, points],
  )

  const markSelectionAsDevices = useCallback(() => {
    if (!selectedPaths.length) return

    const selectionUnique = Array.from(new Set(selectedPaths))

    // If the user selected overlapping folders (ancestor/descendant), keep only the most-specific
    // to preserve the "no point belongs to two devices" invariant.
    const droppedFromSelection: string[] = []
    const toAdd: string[] = []
    for (const candidate of selectionUnique) {
      let isAncestorOfAnotherSelected = false
      for (const other of selectionUnique) {
        if (candidate === other) continue
        if (getPathRelation(candidate, other) === 'ancestor') {
          isAncestorOfAnotherSelected = true
          break
        }
      }

      if (isAncestorOfAnotherSelected) droppedFromSelection.push(candidate)
      else toAdd.push(candidate)
    }

    const upstreamConflictsSet = new Set<string>()
    const downstreamConflictsSet = new Set<string>()
    const toRemoveSet = new Set<string>()

    for (const existing of devicePaths) {
      for (const incoming of toAdd) {
        const rel = getPathRelation(existing, incoming)
        if (rel === 'ancestor') {
          // Existing is upstream of the new device.
          upstreamConflictsSet.add(existing)
          toRemoveSet.add(existing)
        } else if (rel === 'descendant') {
          // Existing is downstream under the new device.
          downstreamConflictsSet.add(existing)
          toRemoveSet.add(existing)
        }
      }
    }

    const toRemove = Array.from(toRemoveSet).sort((a, b) => a.localeCompare(b))
    const upstreamConflicts = Array.from(upstreamConflictsSet).sort((a, b) => a.localeCompare(b))
    const downstreamConflicts = Array.from(downstreamConflictsSet).sort((a, b) => a.localeCompare(b))

    const nextDevices = Array.from(
      new Set([...devicePaths.filter((p) => !toRemoveSet.has(p)), ...toAdd]),
    )
    const reassignmentGroups = computeReassignmentGroups(devicePaths, nextDevices)

    if (toRemove.length || droppedFromSelection.length) {
      setPendingConflict({
        toAdd: [...toAdd].sort((a, b) => a.localeCompare(b)),
        toRemove,
        droppedFromSelection: droppedFromSelection.sort((a, b) => a.localeCompare(b)),
        upstreamConflicts,
        downstreamConflicts,
        reassignmentGroups,
      })
      setOpenReassignGroups({})
      return
    }

    addDevices(toAdd)
    setSelectedPaths([])
  }, [addDevices, computeReassignmentGroups, devicePaths, selectedPaths])

  const confirmDeviceConflict = useCallback(() => {
    if (!pendingConflict) return
    applyDeviceChange(pendingConflict.toAdd, pendingConflict.toRemove)
    setPendingConflict(null)
    setOpenReassignGroups({})
    setSelectedPaths([])
  }, [applyDeviceChange, pendingConflict])

  const cancelDeviceConflict = useCallback(() => {
    setPendingConflict(null)
    setOpenReassignGroups({})
  }, [])

  const removeDevices = useCallback((pathsToRemove: string[]) => {
    if (!pathsToRemove.length) return
    setDevicePaths((prev) => {
      const removeSet = new Set(pathsToRemove)
      return prev.filter((p) => !removeSet.has(p))
    })
  }, [])

  const beginMergeDevices = useCallback((memberPathsToMerge: string[], suggestedName: string) => {
    const memberPaths = Array.from(new Set(memberPathsToMerge)).filter(Boolean)
    if (memberPaths.length < 2) return
    setPendingMerge({ memberPaths, suggestedName })
    setMergeName(suggestedName)
  }, [])

  const cancelMergeDevices = useCallback(() => {
    setPendingMerge(null)
    setMergeName('')
  }, [])

  const confirmMergeDevices = useCallback(() => {
    if (!pendingMerge) return
    const name = mergeName.trim()
    if (!name) return

    const memberSet = new Set(pendingMerge.memberPaths)
    const id = `merged_${Date.now()}_${Math.random().toString(16).slice(2)}`

    setDevicePaths((prev) => {
      const out = new Set(prev)
      for (const p of memberSet) out.add(p)
      return Array.from(out)
    })

    setMergedDevices((prev) => {
      const kept = prev.filter((md) => !md.memberPaths.some((p) => memberSet.has(p)))
      return [...kept, { id, name, memberPaths: Array.from(memberSet).sort((a, b) => a.localeCompare(b)) }]
    })

    cancelMergeDevices()
  }, [cancelMergeDevices, mergeName, pendingMerge])

  const exportCsvWithDeviceNames = useCallback(() => {
    if (!csvText || !selectedColumn) return

    const rows = d3.csvParse(csvText)
    const inputColumns = rows.columns ?? []

    const outputColumns = inputColumns.includes('device_name') ? inputColumns : [...inputColumns, 'device_name']

    const updated = rows.map((r) => {
      const rec = r as Record<string, string | undefined>
      const pointPath = (rec[selectedColumn] ?? '').trim()
      const isHidden =
        pointPath && hiddenFolderPaths.length
          ? isAtOrDownstreamOfAnyFolderPath(pointPath, hiddenFolderPaths)
          : false
      const owner = !isHidden && pointPath ? computeOwnerDevice(pointPath, devicePaths) : null
      const device_name = isHidden ? '-' : owner ? displayDeviceName(owner) : ''
      return { ...rec, device_name }
    })

    const out = d3.csvFormat(updated as any[], outputColumns)
    const blob = new Blob([out], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = 'export_with_device_name.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [computeOwnerDevice, csvText, devicePaths, displayDeviceName, hiddenFolderPaths, selectedColumn])

  const pruneSelectedFolders = useCallback(
    (pathsToHide: string[]) => {
      const nextToHide = pathsToHide.map((p) => p.trim()).filter(Boolean)
      if (!nextToHide.length) return

      setHiddenFolderPaths((prev) => normalizeHiddenFolderPaths([...prev, ...nextToHide]))

      // Drop hidden folders from the current selection.
      setSelectedPaths((prev) => prev.filter((p) => !isAtOrDownstreamOfAnyFolderPath(p, nextToHide)))
    },
    [normalizeHiddenFolderPaths],
  )

  useEffect(() => {
    if (!isHelpOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsHelpOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isHelpOpen])

  useEffect(() => {
    if (!pendingMerge) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelMergeDevices()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelMergeDevices, pendingMerge])

  const setSelection = useCallback((next: string[]) => {
    setSelectedPaths(Array.from(new Set(next)))
  }, [])

  const toggleSelection = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const set = new Set(prev)
      if (set.has(path)) set.delete(path)
      else set.add(path)
      return Array.from(set)
    })
  }, [])

  const selectSingle = useCallback((path: string) => {
    setSelectedPaths([path])
  }, [])

  const getContentSize = useCallback((): { width: number; height: number } => {
    const el = shellRef.current
    if (!el) return { width: 0, height: 0 }
    const rect = el.getBoundingClientRect()
    const cs = window.getComputedStyle(el)
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    return {
      width: Math.max(0, rect.width - padX),
      height: Math.max(0, rect.height - padY),
    }
  }, [])

  const clampSplitX = useCallback(
    (value: number): number => {
      const { width } = getContentSize()
      const gutter = 12
      const minGraph = 520
      const minRight = 360
      const maxGraph = Math.max(minGraph, width - gutter - minRight)
      return Math.min(maxGraph, Math.max(minGraph, value))
    },
    [getContentSize],
  )

  const clampSplitY = useCallback(
    (value: number): number => {
      const { height } = getContentSize()
      const gutter = 12
      const minTop = 240
      const minBottom = 240
      const maxTop = Math.max(minTop, height - gutter - minBottom)
      return Math.min(maxTop, Math.max(minTop, value))
    },
    [getContentSize],
  )

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const { width, height } = getContentSize()
    if (splitX == null && width > 0) setSplitX(clampSplitX(width * 0.75))
    if (splitY == null && height > 0) setSplitY(clampSplitY(height * 0.6))
  }, [clampSplitX, clampSplitY, getContentSize, splitX, splitY])

  useEffect(() => {
    const onResize = () => {
      if (splitX != null) setSplitX((v) => (v == null ? v : clampSplitX(v)))
      if (splitY != null) setSplitY((v) => (v == null ? v : clampSplitY(v)))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampSplitX, clampSplitY, splitX, splitY])

  const endDrag = useCallback(() => {
    dragRef.current = null
    setIsDraggingX(false)
    setIsDraggingY(false)
    document.body.classList.remove('isResizing')
    if (splitX != null) localStorage.setItem('layout.splitX', String(splitX))
    if (splitY != null) localStorage.setItem('layout.splitY', String(splitY))
  }, [splitX, splitY])

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return

      if (drag.axis === 'x') {
        const next = clampSplitX(drag.startSplit + (e.clientX - drag.startClient))
        setSplitX(next)
      } else {
        const next = clampSplitY(drag.startSplit + (e.clientY - drag.startClient))
        setSplitY(next)
      }
    }

    const onPointerUp = () => {
      if (!dragRef.current) return
      endDrag()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [clampSplitX, clampSplitY, endDrag])

  const startDragX = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (splitX == null) return
      e.preventDefault()
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      dragRef.current = { axis: 'x', startClient: e.clientX, startSplit: splitX }
      setIsDraggingX(true)
      document.body.classList.add('isResizing')
    },
    [splitX],
  )

  const startDragY = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (splitY == null) return
      e.preventDefault()
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      dragRef.current = { axis: 'y', startClient: e.clientY, startSplit: splitY }
      setIsDraggingY(true)
      document.body.classList.add('isResizing')
    },
    [splitY],
  )

  const shellStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (splitX == null || splitY == null) return undefined
    return {
      gridTemplateColumns: `${Math.round(splitX)}px var(--gutter-size) 1fr`,
      gridTemplateRows: `${Math.round(splitY)}px var(--gutter-size) 1fr`,
    }
  }, [splitX, splitY])

  return (
    <div className="appShell" ref={shellRef} style={shellStyle}>
      <main className="graphPane" aria-label="Graph area">
        <Graph
          treeData={treeData}
          devicePaths={devicePaths}
          mergedDevicePaths={mergedDevicePaths}
          hiddenFolderPaths={hiddenFolderPaths}
          points={points}
          onUnhideHiddenFolders={(pathsToUnhide: string[]) => {
            if (!pathsToUnhide.length) return
            const removeSet = new Set(pathsToUnhide)
            setHiddenFolderPaths((prev) => prev.filter((p) => !removeSet.has(p)))
          }}
          deviceCount={deviceEntityCount}
          selectedPaths={selectedPaths}
          statsReady={Boolean(selectedColumn)}
          totalPointsCount={unassignedStats.totalPointsCount}
          unassignedPointsCount={unassignedStats.unassignedPointsCount}
          unassignedFolderPaths={unassignedStats.unassignedFolderPaths}
          onSelectSingle={selectSingle}
          onToggleSelected={toggleSelection}
          onSetSelection={setSelection}
          columns={columns}
          selectedColumn={selectedColumn}
          selectedTypeColumn={selectedTypeColumn}
          onUploadCsv={onUploadCsv}
          onSelectColumn={onSelectColumn}
          onSelectTypeColumn={onSelectTypeColumn}
          onExportCsv={exportCsvWithDeviceNames}
          exportDisabled={!csvText || !selectedColumn}
          onOpenHelp={() => setIsHelpOpen(true)}
        />
      </main>

      <div
        className={isDraggingX ? 'gutter vertical active' : 'gutter vertical'}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize graph and side panes"
        onPointerDown={startDragX}
      />

      <Sidebar
        selectedPaths={selectedPaths}
        devicePaths={devicePaths}
        mergedDevicePaths={mergedDevicePaths}
        displayDeviceName={displayDeviceName}
        points={points}
        onMarkDevices={markSelectionAsDevices}
        onMergeSelectedAsMergedDevice={(paths: string[], suggestedName: string) => beginMergeDevices(paths, suggestedName)}
        onPruneSelected={(pathsToHide: string[]) => pruneSelectedFolders(pathsToHide)}
      />

      <div
        className={isDraggingY ? 'gutter horizontal active' : 'gutter horizontal'}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize selection and devices panes"
        onPointerDown={startDragY}
      />

      <Devices
        devicePaths={devicePaths}
        mergedDevices={mergedDevices}
        selectedPaths={selectedPaths}
        points={points}
        onRemoveDevices={removeDevices}
        displayDeviceName={displayDeviceName}
        onRenameDevice={renameDevice}
        onBeginMerge={beginMergeDevices}
      />

      {pendingMerge ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="Merge devices"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancelMergeDevices()
          }}
        >
          <div className="modalPanel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">Merge devices</div>
              <div className="modalDescription">Pick a name for the merged device. This name is used in CSV export.</div>
            </div>

            <div className="modalScroll">
              <div className="modalBody">
                <div className="modalSection">
                  <div className="modalSectionTitle">Merged device name</div>
                  <input
                    className="deviceNameInput"
                    value={mergeName}
                    onChange={(e) => setMergeName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        confirmMergeDevices()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelMergeDevices()
                      }
                    }}
                    aria-label="Merged device name"
                  />
                </div>

                <div className="modalSection">
                  <div className="modalSectionTitle">Devices to merge ({pendingMerge.memberPaths.length})</div>
                  <ul className="modalList">
                    {pendingMerge.memberPaths.map((p) => (
                      <li key={p}>{displayDevicePath(p)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="modalFooter">
              <div className="modalButtons">
                <button className="modalButton" type="button" onClick={cancelMergeDevices}>
                  Cancel
                </button>
                <button className="modalButton primary" type="button" onClick={confirmMergeDevices} disabled={!mergeName.trim()}>
                  Merge
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingConflict ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Device overlap warning">
          <div className="modalPanel">
            <div className="modalHeader">
              <div className="modalTitle">You're about to reassign points</div>
              <div className="modalDescription">
                Some of your selected devices overlap existing devices. If you continue, we'll adjust devices so the
                same point doesn't end up assigned to two devices.
              </div>
            </div>

            <div className="modalScroll">
              <div className="modalBody">

                <div className="modalSummary">
                  <div>
                    <span className="modalLabel">Add:</span> {pendingConflict.toAdd.length}
                  </div>
                  <div>
                    <span className="modalLabel">Remove:</span> {pendingConflict.toRemove.length}
                  </div>
                </div>

                {pendingConflict.reassignmentGroups.length ? (
                  <div className="reassignGroups" aria-label="Reassignment groups">
                    {pendingConflict.reassignmentGroups.map((g) => {
                      const groupKey = `${g.fromDevicePath ?? '∅'}→${g.toDevicePath ?? '∅'}`
                      const isOpen = !!openReassignGroups[groupKey]

                      const fromName = g.fromDevicePath ? displayDeviceName(g.fromDevicePath) : 'Unassigned'
                      const toName = g.toDevicePath ? displayDeviceName(g.toDevicePath) : 'Unassigned'

                      const directionRel =
                        g.fromDevicePath && g.toDevicePath ? getPathRelation(g.toDevicePath, g.fromDevicePath) : 'disjoint'
                      const isMovingUp = directionRel === 'ancestor'
                      const isMovingDown = directionRel === 'descendant'
                      const quickLabel = isMovingUp
                        ? 'Moving points up'
                        : isMovingDown
                          ? 'Moving points down'
                          : 'Reassigning points'
                      const quickArrow = isMovingUp ? '↑' : isMovingDown ? '↓' : '↔'

                      const headerTitle = g.fromDevicePath && g.toDevicePath
                        ? `${fromName} → ${toName}`
                        : 'Reassignment'

                      return (
                        <div key={groupKey} className={`reassignGroup ${isOpen ? 'open' : ''}`}>
                          <button
                            type="button"
                            className="reassignHeader"
                            aria-expanded={isOpen}
                            title={headerTitle}
                            onClick={() => {
                              setOpenReassignGroups((prev) => ({
                                ...prev,
                                [groupKey]: !prev[groupKey],
                              }))
                            }}
                          >
                            <div className="reassignLeft">
                              <div className="reassignQuick">
                                <span className="reassignQuickArrow">{quickArrow}</span>
                                <span className="reassignQuickText">{quickLabel}</span>
                              </div>
                              <div className="reassignPair" aria-label={`From ${fromName} to ${toName}`}>
                                <span className="reassignDeviceName">{fromName}</span>
                                <span className="reassignMidArrow">→</span>
                                <span className="reassignDeviceName">{toName}</span>
                              </div>
                            </div>

                            <div className="reassignRight">
                              <span className="reassignCount">{g.pointPaths.length} points</span>
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
                            </div>
                          </button>

                          {isOpen ? (
                            <ul className="modalPointList" aria-label="Points">
                              {g.pointPaths.map((pp) => {
                                const trimmed = pp.trim()
                                const leaf = trimmed.split('/').pop() ?? trimmed
                                return (
                                  <li key={pp} className="modalPointItem" title={trimmed}>
                                    <span className="modalPointLine">
                                      <span className="modalPointName">{leaf}</span>
                                      <span className="modalPointPath">{trimmed}</span>
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {pendingConflict.droppedFromSelection.length ? (
                  <div className="modalSection">
                    <div className="modalSectionTitle">Some selections overlap</div>
                    <div className="modalText">
                      You selected folders that contain each other. If you continue, we'll keep the most-specific ones
                      and drop the broader ones:
                    </div>
                    <ul className="modalList">
                      {pendingConflict.droppedFromSelection.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="modalFooter">
              <div className="modalButtons">
                <button className="modalButton" type="button" onClick={cancelDeviceConflict}>
                  Cancel
                </button>
                <button className="modalButton primary" type="button" onClick={confirmDeviceConflict}>
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isHelpOpen ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="Instructions"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsHelpOpen(false)
          }}
        >
          <div className="modalPanel helpPanel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">How to use this tool</div>
              <div className="modalDescription">
                Upload a CSV, mark folders as devices, then export the same CSV with a new <span className="kbd">device_name</span>{' '}
                column.
              </div>
            </div>

            <div className="modalScroll">
              <div className="modalBody">
                <ol className="helpSteps" aria-label="Steps">
                  <li className="helpStep">
                    <div className="helpStepTitle">1) Load CSV</div>
                    <div className="helpStepText">
                      Upload your CSV, then select the <span className="kbd">slotpath</span> column and your point type column.
                    </div>
                  </li>
                  <li className="helpStep">
                    <div className="helpStepTitle">2) Select device folders</div>
                    <div className="helpStepText">Select folders in the graph that represent a device.</div>
                  </li>
                  <li className="helpStep">
                    <div className="helpStepTitle">3) Manage devices</div>
                    <div className="helpStepText">Use checkboxes to batch-delete and the Select-all row for speed.</div>
                  </li>
                </ol>

                <div className="helpSectionTitle">Helpful tools</div>
                <div className="helpTools" aria-label="Helpful tools">
                  <div className="helpTool">
                    <div className="helpToolTitle">Batch select</div>
                    <br></br>
                    <div className="helpToolText">
                      <b>Click multi-select:</b>
                      <span className="helpToolLine">
                        Mac: <span className="kbd">Cmd</span>-click
                      </span>
                      <span className="helpToolLine">
                        Windows/Linux: <span className="kbd">Ctrl</span>-click
                      </span>
                      <b>Drag multi-select:</b>
                      <span className="helpToolLine">
                        Mac: <span className="kbd">Cmd</span>-drag
                      </span>
                      <span className="helpToolLine">
                        Windows/Linux: <span className="kbd">Ctrl</span>-drag
                      </span>
                      Devices list: use the Select-all row and per-device checkboxes.
                    </div>
                  </div>

                  <div className="helpTool">
                    <div className="helpToolTitle">Jump to next unassigned</div>
                    <div className="helpToolText">
                      Use the floating <span className="kbd">Jump to next unassigned</span> button to pan to the next folder that still has
                      unassigned points.
                    </div>
                  </div>

                  <div className="helpTool">
                    <div className="helpToolTitle">Pane resizing</div>
                    <div className="helpToolText">Drag the thin gutter lines to resize panes. Your layout is saved automatically.</div>
                  </div>

                  <div className="helpTool placeholder" aria-disabled="true">
                    <div className="helpToolTitle">Device merging (coming soon)</div>
                    <div className="helpToolText">This will let you merge two device folders into one combined device.</div>
                  </div>

                  <div className="helpTool">
                    <div className="helpToolTitle">Stats pane</div>
                    <div className="helpToolText">
                      The minimap + stats area shows device count and unassigned progress so you can track how close you are to “all assigned”.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modalFooter">
              <div className="modalButtons">
                <button className="modalButton" type="button" onClick={() => setIsHelpOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
