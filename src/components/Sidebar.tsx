import { useMemo, useState } from 'react'
import { Merge, Scissors } from 'lucide-react'
import type { PointRecord } from '../lib/fileTree'
import { listLeafPointsUnderFolderByType } from '../lib/fileTree'
import { isDownstreamOfAnyFolderPath } from '../lib/fileTree'
import { decodeStandardName } from '../lib/fileTree'

type Props = {
  selectedPaths: string[]
  devicePaths: string[]
  mergedDevicePaths: string[]
  displayDeviceName: (path: string) => string
  points: PointRecord[]
  onMarkDevices: () => void
  onMergeSelectedAsMergedDevice: (paths: string[], suggestedName: string) => void
  onPruneSelected: (paths: string[]) => void
}

export default function Sidebar({
  selectedPaths,
  devicePaths,
  mergedDevicePaths,
  displayDeviceName,
  points,
  onMarkDevices,
  onMergeSelectedAsMergedDevice,
  onPruneSelected,
}: Props) {
  const [openPaths, setOpenPaths] = useState<string[]>([])
  const [collapsedTypeKeys, setCollapsedTypeKeys] = useState<string[]>([])
  const sorted = [...selectedPaths].sort((a, b) => a.localeCompare(b))
  const count = sorted.length
  const buttonLabel = count <= 1 ? 'Mark as device' : `Mark ${count} as device`
  const displayPath = (p: string) => (p.startsWith('root/') ? p.slice('root/'.length) : p)

  const deviceSet = new Set(devicePaths)
  const mergedDeviceSet = new Set(mergedDevicePaths)

  const allSelectedAreDevices = count > 0 && sorted.every((p) => deviceSet.has(p))

  const nonDeviceSelectedPaths = useMemo(() => sorted.filter((p) => !deviceSet.has(p)), [deviceSet, sorted])
  const nonDeviceSelectedCount = nonDeviceSelectedPaths.length
  const markDisabled = count === 0 || allSelectedAreDevices
  const mergeDisabled = markDisabled || nonDeviceSelectedCount < 2
  const pruneDisabled = nonDeviceSelectedCount < 1

  const displayName = (p: string) => {
    if (deviceSet.has(p)) return displayDeviceName(p)
    const raw = displayPath(p).split('/').pop() ?? displayPath(p)
    return decodeStandardName(raw)
  }

  const pointCountByPath = new Map<string, number>()
  for (const p of sorted) {
    const byType = listLeafPointsUnderFolderByType(p, points)
    const union = new Set<string>()
    for (const g of byType) for (const pt of g.points) union.add(pt)
    pointCountByPath.set(p, union.size)
  }

  const openSet = new Set(openPaths)
  const collapsedTypeSet = new Set(collapsedTypeKeys)
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

  const toggleOpen = (path: string) => {
    setOpenPaths((prev) => {
      const s = new Set(prev)
      if (s.has(path)) s.delete(path)
      else s.add(path)
      return Array.from(s)
    })
  }

  return (
    <aside className="sidebarPane" aria-label="Sidebar">
      <div className="sidebarContent">
        <div className="sidebarHeader">
          <div className="sidebarTitleRow">
            <div className="sidebarSectionTitle">Selection</div>
            <div className="sidebarSectionCount">{count}</div>
          </div>
        </div>

        <div className="sidebarListArea">
          {count === 0 ? (
            <div className="sidebarEmpty">
              Click folders to select. Cmd-click (macOS) / Ctrl-click (Windows) to multi-select. Cmd/Ctrl-drag
              on the background to box-select.
            </div>
          ) : (
            <ul className="selectionList">
              {sorted.map((p) => (
                <li
                  key={p}
                  className={
                    openSet.has(p)
                      ? 'selectionItem open'
                      : isDownstreamOfAnyFolderPath(p, devicePaths) && !deviceSet.has(p)
                        ? 'selectionItem greyed'
                        : 'selectionItem'
                  }
                >
                  <button
                    className="cardToggle"
                    type="button"
                    onClick={() => toggleOpen(p)}
                    aria-expanded={openSet.has(p)}
                  >
                    <span className="cardMain">
                      <span
                        className={
                          deviceSet.has(p)
                            ? mergedDeviceSet.has(p)
                              ? 'nodeBadgeWrap halo mergedDevice'
                              : 'nodeBadgeWrap halo device'
                            : isDownstreamOfAnyFolderPath(p, devicePaths)
                              ? 'nodeBadgeWrap halo grey'
                              : 'nodeBadgeWrap halo'
                        }
                        aria-hidden
                      >
                        <span
                          className={
                            deviceSet.has(p)
                              ? mergedDeviceSet.has(p)
                                ? 'nodeBadge mergedDevice'
                                : 'nodeBadge device'
                              : isDownstreamOfAnyFolderPath(p, devicePaths)
                                ? 'nodeBadge grey'
                                : 'nodeBadge'
                          }
                        />
                      </span>

                      <span className="cardLeft">
                        <span className="selectionName" title={displayName(p)}>
                          {displayName(p)}
                        </span>
                        <span className="selectionPath" title={displayPath(p)}>
                          {displayPath(p)}
                        </span>
                      </span>
                    </span>

                    <span className="cardRight" aria-label={`${pointCountByPath.get(p) ?? 0} points`}>
                      <span className="cardMeta">{pointCountByPath.get(p) ?? 0} points</span>
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

                  {openSet.has(p) ? (
                    <div className="cardDetails">
                      {(() => {
                        const groups = listLeafPointsUnderFolderByType(p, points)
                        if (!groups.length) return <div className="cardEmpty">No points found under this folder.</div>

                        return (
                          <ul className="typeGroupList" role="list" aria-label="Point types">
                            {groups.map((g) => {
                              // Default open when parent is open; user can collapse.
                              const isOpen = !collapsedTypeSet.has(typeKey(p, g.type))
                              return (
                                <li key={g.type} className={isOpen ? 'typeGroupItem open' : 'typeGroupItem'}>
                                  <button
                                    className="typeGroupToggle"
                                    type="button"
                                    onClick={() => toggleTypeGroup(p, g.type)}
                                    aria-expanded={isOpen}
                                  >
                                    <span className="typeGroupLeft" title={g.type}>
                                      <span className="typeGroupName">{g.type}</span>
                                    </span>
                                    <span className="typeGroupRight" aria-label={`${g.points.length} points`}
                                    >
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
              ))}
            </ul>
          )}
        </div>

        <div className="sidebarFooter">
          <div className="sidebarFooterActions">
            <button
              className="sidebarButton"
              type="button"
              disabled={markDisabled}
              onClick={onMarkDevices}
              title={
                count === 0
                  ? 'Select folders to mark as devices'
                  : allSelectedAreDevices
                    ? 'All selected folders are already devices'
                    : 'Mark selected folders as devices'
              }
            >
              {buttonLabel}
            </button>

            <button
              className="devicesHeaderButton merge sidebarMergeButton"
              type="button"
              disabled={mergeDisabled}
              onClick={() => {
                if (mergeDisabled) return
                const suggested = displayDeviceName(nonDeviceSelectedPaths[0]!)
                onMergeSelectedAsMergedDevice(nonDeviceSelectedPaths, suggested)
              }}
              aria-label={mergeDisabled ? 'Merge selected folders into a merged device (disabled)' : 'Merge selected folders into a merged device'}
              title={
                markDisabled
                  ? count === 0
                    ? 'Select folders to merge'
                    : 'All selected folders are already devices'
                  : nonDeviceSelectedCount < 2
                    ? 'Select at least 2 non-device folders to merge'
                    : 'Create a merged device from the selected folders'
              }
            >
              <Merge size={18} aria-hidden />
            </button>

            <button
              className={
                pruneDisabled
                  ? 'devicesHeaderButton prune sidebarPruneButton disabled'
                  : 'devicesHeaderButton prune sidebarPruneButton'
              }
              type="button"
              disabled={pruneDisabled}
              onClick={() => {
                if (pruneDisabled) return
                onPruneSelected(nonDeviceSelectedPaths)
              }}
              aria-label={pruneDisabled ? 'Prune (hide) selected folders (disabled)' : 'Prune (hide) selected folders'}
              title={
                pruneDisabled
                  ? count === 0
                    ? 'Select folders to prune'
                    : 'Select at least 1 non-device folder to prune'
                  : 'Hide the selected folders from the graph (they will export with device_name = -)'
              }
            >
              <Scissors size={18} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
