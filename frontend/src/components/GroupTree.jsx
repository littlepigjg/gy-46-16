import { useState, useEffect } from 'react'
import {
  getGroupTree, toggleGroupCollapse, createGroup,
  updateGroup, deleteGroup, moveGroup, reorderGroups
} from '../api.js'

function TreeNode({ node, level, selectedGroupId, onSelect, onToggleCollapse,
  onAddSubGroup, onEdit, onDelete, onDrop, expandedMap, setExpandedMap,
  dragId, setDragId }) {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expandedMap[node.id] !== undefined
    ? expandedMap[node.id]
    : !(node.is_collapsed === 1 || node.is_collapsed === true)
  const isSelected = selectedGroupId === node.id

  const handleToggle = (e) => {
    e.stopPropagation()
    setExpandedMap(prev => ({ ...prev, [node.id]: !isExpanded }))
    onToggleCollapse(node.id)
  }

  const handleDragStart = (e) => {
    e.stopPropagation()
    setDragId(node.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragId && dragId !== node.id) {
      onDrop(dragId, node.id)
    }
    setDragId(null)
  }

  const handleDragEnd = () => {
    setDragId(null)
  }

  return (
    <div className="group-tree-node">
      <div
        className={`flex items-center gap-1 py-1.5 px-2 rounded-lg cursor-pointer text-sm transition-all
          ${isSelected ? 'bg-blue-100 text-blue-800 font-medium' : 'hover:bg-gray-100 text-gray-700'}
          ${dragId === node.id ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {hasChildren ? (
          <button
            onClick={handleToggle}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-200"
          >
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="flex-shrink-0 w-5 h-5" />
        )}

        <span
          className="flex-shrink-0 w-4 h-4 rounded"
          style={{ backgroundColor: node.color || '#6366f1' }}
        />

        <span className="flex-1 truncate">{node.name}</span>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onAddSubGroup(node.id) }}
            className="p-1 rounded hover:bg-blue-100 text-blue-600"
            title="添加子分组"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(node) }}
            className="p-1 rounded hover:bg-yellow-100 text-yellow-600"
            title="编辑"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(node) }}
            className="p-1 rounded hover:bg-red-100 text-red-600"
            title="删除"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
              onToggleCollapse={onToggleCollapse}
              onAddSubGroup={onAddSubGroup}
              onEdit={onEdit}
              onDelete={onDelete}
              onDrop={onDrop}
              expandedMap={expandedMap}
              setExpandedMap={setExpandedMap}
              dragId={dragId}
              setDragId={setDragId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function GroupTree({
  selectedGroupId, onSelect, onAddRoot, onRefresh,
  showAddButton = true
}) {
  const [tree, setTree] = useState([])
  const [loading, setLoading] = useState(false)
  const [expandedMap, setExpandedMap] = useState({})
  const [dragId, setDragId] = useState(null)

  const loadTree = async () => {
    setLoading(true)
    try {
      const res = await getGroupTree()
      setTree(res.data)
    } catch (err) {
      console.error('加载分组失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTree()
  }, [])

  useEffect(() => {
    if (onRefresh) {
      window.__refreshGroupTree = loadTree
    }
  }, [onRefresh])

  const handleToggleCollapse = async (id) => {
    try {
      await toggleGroupCollapse(id)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDrop = async (sourceId, targetParentId) => {
    try {
      await moveGroup(sourceId, targetParentId)
      await loadTree()
    } catch (err) {
      alert('移动失败: ' + (err.response?.data?.error || err.message))
    }
  }

  const handleAddSubGroup = (parentId) => {
    window.__openGroupDialog && window.__openGroupDialog({ parent_id: parentId, mode: 'create' })
  }

  const handleEdit = (group) => {
    window.__openGroupDialog && window.__openGroupDialog({ group, mode: 'edit' })
  }

  const handleDelete = async (group) => {
    const msg = `确定删除分组 "${group.name}" 吗？\n\n点"确定"保留其中的URL，点"取消"取消操作。\n\n要连URL一起删除，请长按Shift再点确定。`
    const deleteUrls = window.event && window.event.shiftKey
    const finalMsg = deleteUrls
      ? `⚠️ 确定删除分组 "${group.name}" 及其所有URL和截图吗？此操作不可恢复！`
      : msg
    if (!confirm(finalMsg)) return
    try {
      await deleteGroup(group.id, deleteUrls)
      if (selectedGroupId === group.id) {
        onSelect(null)
      }
      await loadTree()
    } catch (err) {
      alert('删除失败: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between p-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">分组管理</h3>
        <div className="flex items-center gap-1">
          {showAddButton && (
            <button
              onClick={() => window.__openGroupDialog && window.__openGroupDialog({ parent_id: null, mode: 'create' })}
              className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600"
              title="新建根分组"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
          <button
            onClick={loadTree}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
            title="刷新"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className={`flex items-center gap-2 py-2 px-3 mx-2 mt-2 rounded-lg cursor-pointer text-sm
          ${selectedGroupId === null ? 'bg-blue-100 text-blue-800 font-medium' : 'hover:bg-gray-100 text-gray-600'}`}
        onClick={() => onSelect(null)}
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
        <span>全部URL</span>
      </div>

      <div
        className={`flex items-center gap-2 py-2 px-3 mx-2 rounded-lg cursor-pointer text-sm
          ${selectedGroupId === 'ungrouped' ? 'bg-blue-100 text-blue-800 font-medium' : 'hover:bg-gray-100 text-gray-600'}`}
        onClick={() => onSelect('ungrouped')}
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        <span>未分组</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading ? (
          <div className="text-center text-gray-500 py-8 text-sm">加载中...</div>
        ) : tree.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-sm">
            暂无分组，点击右上角添加
          </div>
        ) : (
          tree.map(node => (
            <TreeNode
              key={node.id}
              node={node}
              level={0}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
              onToggleCollapse={handleToggleCollapse}
              onAddSubGroup={handleAddSubGroup}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDrop={handleDrop}
              expandedMap={expandedMap}
              setExpandedMap={setExpandedMap}
              dragId={dragId}
              setDragId={setDragId}
            />
          ))
        )}
      </div>

      <div className="border-t border-gray-100 p-3">
        <p className="text-xs text-gray-400">
          提示: 拖拽分组可改变层级<br/>
          删除时按住 Shift 可连同URL一起删除
        </p>
      </div>
    </div>
  )
}
