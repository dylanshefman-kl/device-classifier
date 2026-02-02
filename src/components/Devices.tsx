import { useEffect, useMemo, useRef, useState } from 'react'
import { Merge, Trash2 } from 'lucide-react'
import type { PointRecord } from '../lib/fileTree'
import { listLeafPointsUnderFolderByType } from '../lib/fileTree'

type Props = {
  devicePaths: string[]
  mergedDevices: Array<{ id: string; name: string; memberPaths: string[] }>
  selectedPaths: string[]
  points: PointRecord[]
  onRemoveDevices: (paths: string[]) => void
  displayDeviceName: (path: string) => string
  onRenameDevice: (path: string, nextName: string) => void
  onBeginMerge: (memberPaths: string[], suggestedName: string) => void
}

type DeviceListItem =
  | {
      kind: 'merged'
      id: string
      name: string
      memberPaths: string[]
    }
  | {
      kind: 'device'
      path: string
    }

export default function Devices({
  devicePaths,
  mergedDevices,
  selectedPaths,
  points,
  onRemoveDevices,
  displayDeviceName,
  onRenameDevice,
  onBeginMerge,
}: Props) {
  const [openKeys, setOpenKeys] = useState<string[]>([])
  const [collapsedTypeKeys, setCollapsedTypeKeys] = useState<string[]>([])
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [draftName, setDraftName] = useState<string>('')
  const selectAllRef = useRef<HTMLInputElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const commitGuardRef = useRef(false)
  const sortedPaths = useMemo(() => [...devicePaths].sort((a, b) => a.localeCompare(b)), [devicePaths])
  const displayPath = (p: string) => (p.startsWith('root/') ? p.slice('root/'.length) : p)

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths])
  const deviceSet = useMemo(() => new Set(devicePaths), [devicePaths])
  const checkedSet = useMemo(() => new Set(checkedKeys), [checkedKeys])

  const mergedMemberSet = useMemo(() => {
    const s = new Set<string>()
    for (const md of mergedDevices) for (const p of md.memberPaths) s.add(p)
    return s
  }, [mergedDevices])

  const items = useMemo<DeviceListItem[]>(() => {
    const mergedItems: DeviceListItem[] = [...mergedDevices]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((md) => ({ kind: 'merged', id: md.id, name: md.name, memberPaths: md.memberPaths }))

    const unmerged: DeviceListItem[] = sortedPaths
      .filter((p) => !mergedMemberSet.has(p))
      .map((p) => ({ kind: 'device', path: p }))

    return [...mergedItems, ...unmerged]
  }, [mergedDevices, mergedMemberSet, sortedPaths])

  const keyFor = (it: DeviceListItem): string => (it.kind === 'merged' ? `m:${it.id}` : `p:${it.path}`)
  const keyToItem = useMemo(() => {
    const m = new Map<string, DeviceListItem>()
    for (const it of items) m.set(keyFor(it), it)
    return m
  }, [items])

  const memberPathsForItem = (it: DeviceListItem): string[] =>
    it.kind === 'merged' ? it.memberPaths : [it.path]

  const anySelectedForItem = (it: DeviceListItem): boolean => {
    const members = memberPathsForItem(it)
    for (const p of members) if (selectedSet.has(p)) return true
    return false
  }

  useEffect(() => {
    setCheckedKeys((prev) =>
      prev.filter((k) => {
        const it = keyToItem.get(k)
        if (!it) return false
        const members = memberPathsForItem(it)
        return members.some((p) => deviceSet.has(p))
      }),
    )
  }, [deviceSet, keyToItem])

  useEffect(() => {
    if (!editingPath) return
    if (!deviceSet.has(editingPath)) {
      setEditingPath(null)
      return
    }
    // Wait for input to mount.
    requestAnimationFrame(() => {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    })
  }, [deviceSet, editingPath])

  const beginEdit = (path: string) => {
    setEditingPath(path)
    setDraftName(displayDeviceName(path))
  }

  const cancelEdit = () => {
    setEditingPath(null)
    setDraftName('')
  }

  const commitEdit = () => {
    if (!editingPath) return
    if (commitGuardRef.current) return
    commitGuardRef.current = true
    onRenameDevice(editingPath, draftName)
    setEditingPath(null)
    setDraftName('')
    // Guard against blur firing right after Enter.
    setTimeout(() => {
      commitGuardRef.current = false
    }, 0)
  }

  const openSet = useMemo(() => new Set(openKeys), [openKeys])
  const collapsedTypeSet = useMemo(() => new Set(collapsedTypeKeys), [collapsedTypeKeys])
  const typeKey = (parentPath: string, type: string) => `${parentPath}::${type}`

  const toggleTypeGroup = (parentPath: string, type: string) => {
    const key = typeKey(parentPath, type)
    setCollapsedTypeKeys((prev) => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return Array.from(s)
    })
  }

  const toggleOpen = (key: string) => {
    setOpenKeys((prev) => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key)
      else s.add(key)
      return Array.from(s)
    })
  }

  const toggleChecked = (path: string) => {
    setCheckedKeys((prev) => {
      const s = new Set(prev)
      if (s.has(path)) s.delete(path)
      else s.add(path)
      return Array.from(s)
    })
  }

  const deleteChecked = () => {
    const toDeleteKeys = Array.from(checkedSet)
    if (toDeleteKeys.length === 0) return
    const paths: string[] = []
    for (const k of toDeleteKeys) {
      const it = keyToItem.get(k)
      if (!it) continue
      for (const p of memberPathsForItem(it)) if (deviceSet.has(p)) paths.push(p)
    }
    const unique = Array.from(new Set(paths))
    if (unique.length === 0) return
    setCheckedKeys([])
    onRemoveDevices(unique)
  }

  const checkedCount = useMemo(() => {
    let c = 0
    for (const it of items) if (checkedSet.has(keyFor(it))) c++
    return c
  }, [checkedSet, items])

  const allChecked = items.length > 0 && checkedCount === items.length
  const someChecked = checkedCount > 0 && !allChecked

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = someChecked
  }, [someChecked])

  const toggleSelectAll = () => {
    if (items.length === 0) return
    setCheckedKeys(allChecked ? [] : items.map(keyFor))
  }

  const mergeSelected = () => {
    if (checkedSet.size < 2) return
    const selectedKeys = Array.from(checkedSet)
    const memberPaths: string[] = []
    let suggestedName = ''
    for (const k of selectedKeys) {
      const it = keyToItem.get(k)
      if (!it) continue
      if (!suggestedName) suggestedName = it.kind === 'merged' ? it.name : displayDeviceName(it.path)
      for (const p of memberPathsForItem(it)) if (deviceSet.has(p)) memberPaths.push(p)
    }
    const unique = Array.from(new Set(memberPaths))
    if (unique.length < 2) return
    onBeginMerge(unique, suggestedName || displayDeviceName(unique[0]!))
  }

  const listLeafPointsUnderFoldersByType = (folders: string[]): Array<{ type: string; points: string[] }> => {
    const map = new Map<string, Set<string>>()
    for (const f of folders) {
      const groups = listLeafPointsUnderFolderByType(f, points)
      for (const g of groups) {
        let set = map.get(g.type)
        if (!set) {
          set = new Set<string>()
          map.set(g.type, set)
        }
        for (const pt of g.points) set.add(pt)
      }
    }
    return Array.from(map.entries())
      .map(([type, set]) => ({ type, points: Array.from(set).sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.type.localeCompare(b.type))
  }

  return (
    <aside className="devicesPane" aria-label="Devices">
      <div className="devicesHeader">
        <div className="devicesTitleRow">
          <div className="devicesTitle">Devices</div>
          <div className="devicesCount">{items.length}</div>
        </div>
        {items.length > 0 ? (
          <div className="devicesHeaderActions">
            <button
              className={checkedSet.size >= 2 ? 'devicesHeaderButton merge' : 'devicesHeaderButton merge disabled'}
              type="button"
              onClick={mergeSelected}
              disabled={checkedSet.size < 2}
              aria-label={checkedSet.size < 2 ? 'Merge selected devices (disabled)' : 'Merge selected devices'}
              title={checkedSet.size < 2 ? 'Select at least 2 devices to merge' : 'Merge selected devices'}
            >
              <Merge size={16} aria-hidden />
            </button>

            <button
              className={checkedSet.size > 0 ? 'devicesHeaderButton danger' : 'devicesHeaderButton danger disabled'}
              type="button"
              onClick={deleteChecked}
              disabled={checkedSet.size === 0}
              aria-label={
                checkedSet.size === 0
                  ? 'Delete selected devices (disabled)'
                  : checkedSet.size === 1
                    ? 'Delete selected device'
                    : `Delete ${checkedSet.size} selected devices`
              }
              title={
                checkedSet.size === 0
                  ? 'Select devices to delete'
                  : checkedSet.size === 1
                    ? 'Delete selected device'
                    : `Delete ${checkedSet.size} selected devices`
              }
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div className="devicesListArea">
        {items.length === 0 ? (
          <div className="sidebarEmpty">Select folders and click “Mark as device” in the sidebar.</div>
        ) : (
          <ul className="deviceList">
            <li className="deviceItem deviceSelectAllItem">
              <div className="selectAllRow">
                <label className="deviceSelect" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <input
                    ref={selectAllRef}
                    className="deviceCheckbox"
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleSelectAll}
                    aria-label={allChecked ? 'Deselect all devices' : 'Select all devices'}
                  />
                </label>
                <span className="selectAllMeta" aria-label={`${checkedCount} selected out of ${items.length}`}>
                  {checkedCount}/{items.length}
                </span>
              </div>
            </li>

            {items.map((it) => {
              const k = keyFor(it)
              const isOpen = openSet.has(k)
              const isChecked = checkedSet.has(k)
              const members = memberPathsForItem(it)
              const isAnySelected = anySelectedForItem(it)
              const shownName = it.kind === 'merged' ? it.name : displayDeviceName(it.path)
              const shownPath =
                it.kind === 'merged'
                  ? `${members.length} folders merged`
                  : displayPath(it.path)

              const groups = it.kind === 'merged' ? listLeafPointsUnderFoldersByType(members) : listLeafPointsUnderFolderByType(it.path, points)
              const union = new Set<string>()
              for (const g of groups) for (const pt of g.points) union.add(pt)
              const pointCount = union.size

              return (
              <li key={k} className={isOpen ? 'deviceItem open' : 'deviceItem'}>
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
                      onChange={() => toggleChecked(k)}
                      aria-label={isChecked ? `Deselect ${shownName}` : `Select ${shownName}`}
                    />
                  </label>

                  <div
                    className="cardToggle"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleOpen(k)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleOpen(k)
                      }
                    }}
                    aria-expanded={isOpen}
                  >
                    <span className="cardMain">
                      <span
                        className={
                          it.kind === 'merged'
                            ? isAnySelected
                              ? 'nodeBadgeWrap halo mergedDevice'
                              : 'nodeBadgeWrap mergedDevice'
                            : isAnySelected
                              ? 'nodeBadgeWrap halo device'
                              : 'nodeBadgeWrap device'
                        }
                        aria-hidden
                      >
                        <span className={it.kind === 'merged' ? 'nodeBadge mergedDevice' : 'nodeBadge device'} />
                      </span>

                      <span className="cardLeft">
                        <span
                          className="deviceNameWrap"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                        >
                          {it.kind === 'device' && editingPath === it.path ? (
                            <input
                              ref={nameInputRef}
                              className="deviceNameInput"
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  commitEdit()
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  cancelEdit()
                                }
                              }}
                              onBlur={commitEdit}
                              aria-label={`Edit device name for ${shownName}`}
                            />
                          ) : (
                            <span
                              className={it.kind === 'device' ? 'deviceName deviceNameEditable' : 'deviceName'}
                              title={it.kind === 'device' ? 'Click to rename' : shownName}
                              onClick={() => {
                                if (it.kind === 'device') beginEdit(it.path)
                              }}
                            >
                              {shownName}
                            </span>
                          )}
                        </span>
                        <span
                          className="devicePath"
                          title={it.kind === 'merged' ? members.map(displayPath).join('\n') : shownPath}
                        >
                          {shownPath}
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

                {isOpen ? (
                  <div className="cardDetails">
                    {(() => {
                      const groups = it.kind === 'merged' ? listLeafPointsUnderFoldersByType(members) : listLeafPointsUnderFolderByType(it.path, points)
                      if (!groups.length) return <div className="cardEmpty">No points found under this folder.</div>
                      return (
                        <ul className="typeGroupList" role="list" aria-label="Point types">
                          {groups.map((g) => {
                            // Default open when device card is expanded; user can collapse.
                            const isOpen = !collapsedTypeSet.has(typeKey(k, g.type))
                            return (
                              <li key={g.type} className={isOpen ? 'typeGroupItem open' : 'typeGroupItem'}>
                                <button
                                  className="typeGroupToggle"
                                  type="button"
                                  onClick={() => toggleTypeGroup(k, g.type)}
                                  aria-expanded={isOpen}
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

                                {isOpen ? (
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
                      )
                    })()}
                  </div>
                ) : null}
              </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
