import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  getUrls, addUrl, deleteUrl, triggerScreenshot, updateUrl,
  getGroupList, getGroup, batchGroupOperation, batchGroupScreenshot,
  getGroupUrls
} from '../api.js'
import GroupTree from '../components/GroupTree.jsx'
import GroupDialog from '../components/GroupDialog.jsx'
import GroupStats from '../components/GroupStats.jsx'
import GroupImportExport from '../components/GroupImportExport.jsx'

const FREQUENCY_LABELS = {
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月'
}

const STATUS_LABELS = {
  active: { label: '启用', color: 'bg-green-100 text-green-800' },
  paused: { label: '暂停', color: 'bg-yellow-100 text-yellow-800' }
}

function buildFlatOptions(groups, parentId = null, level = 0) {
  const result = []
  const children = groups.filter(g => g.parent_id === parentId)
  children.sort((a, b) => a.sort_order - b.sort_order).forEach(g => {
    result.push({
      id: g.id,
      label: `${'　'.repeat(level)}${level > 0 ? '└ ' : ''}${g.name}`,
      color: g.color
    })
    result.push(...buildFlatOptions(groups, g.id, level + 1))
  })
  return result
}

export default function UrlList() {
  const [urls, setUrls] = useState([])
  const [groups, setGroups] = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [currentGroup, setCurrentGroup] = useState(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({ url: '', name: '', frequency: 'daily', group_id: null })
  const [loading, setLoading] = useState(false)
  const [screenshottingId, setScreenshottingId] = useState(null)
  const [batchScreenshotLoading, setBatchScreenshotLoading] = useState(false)

  const [showGroupDialog, setShowGroupDialog] = useState(false)
  const [groupDialogData, setGroupDialogData] = useState(null)
  const [showImportExport, setShowImportExport] = useState(false)

  const [selectedUrlIds, setSelectedUrlIds] = useState(new Set())
  const [showBatchBar, setShowBatchBar] = useState(false)

  const [showStats, setShowStats] = useState(true)

  const navigate = useNavigate()

  const loadUrls = useCallback(async () => {
    setLoading(true)
    try {
      let res
      if (selectedGroupId === 'ungrouped') {
        res = await getUrls({ group_id: 'null' })
      } else if (selectedGroupId !== null && selectedGroupId !== undefined) {
        res = await getGroupUrls(selectedGroupId, true)
      } else {
        res = await getUrls()
      }
      setUrls(res.data)
    } catch (err) {
      alert('加载失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [selectedGroupId])

  const loadGroups = async () => {
    try {
      const res = await getGroupList()
      setGroups(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const loadCurrentGroup = async () => {
    if (selectedGroupId && selectedGroupId !== null && selectedGroupId !== 'ungrouped') {
      try {
        const res = await getGroup(selectedGroupId)
        setCurrentGroup(res.data)
      } catch (e) {
        console.error(e)
      }
    } else {
      setCurrentGroup(null)
    }
  }

  useEffect(() => {
    loadUrls()
    loadGroups()
    loadCurrentGroup()
  }, [loadUrls, selectedGroupId])

  useEffect(() => {
    window.__openGroupDialog = (data) => {
      setGroupDialogData(data)
      setShowGroupDialog(true)
    }
  }, [])

  useEffect(() => {
    if (currentGroup && currentGroup.default_frequency) {
      setFormData(prev => ({ ...prev, frequency: currentGroup.default_frequency }))
    }
  }, [currentGroup])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.url || !formData.name) {
      alert('请填写完整信息')
      return
    }
    setLoading(true)
    try {
      const gid = (selectedGroupId && selectedGroupId !== 'ungrouped')
        ? selectedGroupId
        : formData.group_id
      await addUrl({
        ...formData,
        group_id: gid === '' ? null : gid
      })
      setShowAddForm(false)
      setFormData({ url: '', name: '', frequency: 'daily', group_id: null })
      loadUrls()
    } catch (err) {
      alert('添加失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`确定删除 "${name}" 及其所有截图吗？`)) return
    try {
      await deleteUrl(id)
      loadUrls()
    } catch (err) {
      alert('删除失败: ' + err.message)
    }
  }

  const handleScreenshot = async (id) => {
    setScreenshottingId(id)
    try {
      await triggerScreenshot(id)
      loadUrls()
      alert('截图完成')
    } catch (err) {
      alert('截图失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setScreenshottingId(null)
    }
  }

  const handleBatchScreenshot = async () => {
    if (!selectedGroupId || selectedGroupId === 'ungrouped') {
      alert('请先选择一个分组')
      return
    }
    if (!confirm('对当前分组（含子分组）所有启用的URL执行立即截图？可能需要较长时间。')) return
    setBatchScreenshotLoading(true)
    try {
      const res = await batchGroupScreenshot(selectedGroupId, true)
      alert(`批量截图完成: 成功 ${res.data.results.filter(r => r.success).length} / 共 ${res.data.total}`)
      loadUrls()
    } catch (err) {
      alert('批量截图失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setBatchScreenshotLoading(false)
    }
  }

  const handleBatchOperation = async (operation, data, message) => {
    if (!confirm(message)) return
    try {
      if (selectedGroupId && selectedGroupId !== 'ungrouped') {
        await batchGroupOperation([selectedGroupId], operation, data, true)
      } else if (selectedUrlIds.size > 0) {
        for (const id of selectedUrlIds) {
          if (operation === 'change_frequency') await updateUrl(id, { frequency: data.frequency })
          else if (operation === 'change_status') await updateUrl(id, { status: data.status })
          else if (operation === 'move_to_group') await updateUrl(id, { group_id: data.target_group_id === '' ? null : data.target_group_id })
          else if (operation === 'delete_urls') await deleteUrl(id)
        }
      }
      setSelectedUrlIds(new Set())
      setShowBatchBar(false)
      loadUrls()
    } catch (err) {
      alert('操作失败: ' + (err.response?.data?.error || err.message))
    }
  }

  const toggleSelectUrl = (id, e) => {
    e.stopPropagation()
    setSelectedUrlIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedUrlIds.size === urls.length && urls.length > 0) {
      setSelectedUrlIds(new Set())
    } else {
      setSelectedUrlIds(new Set(urls.map(u => u.id)))
    }
  }

  useEffect(() => {
    setShowBatchBar(selectedUrlIds.size > 0)
  }, [selectedUrlIds])

  const allGroupOptions = buildFlatOptions(groups)
  const currentGroupLabel = selectedGroupId === null ? '全部URL'
    : selectedGroupId === 'ungrouped' ? '未分组'
    : currentGroup?.name || `分组 #${selectedGroupId}`

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-gray-800">
            {currentGroupLabel}
          </h2>
          {currentGroup && (
            <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
              {currentGroup.url_count || 0} 个URL · {currentGroup.screenshot_count || 0} 张截图
            </span>
          )}
          {loading && <span className="text-xs text-gray-400">加载中...</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowStats(p => !p)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${showStats ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            📊 {showStats ? '隐藏统计' : '显示统计'}
          </button>
          <button
            onClick={() => setShowImportExport(true)}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          >
            📦 导入/导出
          </button>
          {selectedGroupId && selectedGroupId !== null && selectedGroupId !== 'ungrouped' && (
            <button
              onClick={handleBatchScreenshot}
              disabled={batchScreenshotLoading}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
            >
              {batchScreenshotLoading ? '截图中...' : '🎯 分组截图'}
            </button>
          )}
          <button
            onClick={() => {
              setFormData(prev => ({
                ...prev,
                group_id: (selectedGroupId && selectedGroupId !== 'ungrouped') ? selectedGroupId : null
              }))
              setShowAddForm(true)
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            + 添加URL
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3 xl:col-span-2">
          <div className="sticky top-4" style={{ maxHeight: 'calc(100vh - 120px)' }}>
            <GroupTree
              selectedGroupId={selectedGroupId}
              onSelect={setSelectedGroupId}
            />
          </div>
        </div>

        <div className="col-span-12 lg:col-span-9 xl:col-span-6 space-y-4">
          {showBatchBar && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-blue-800">
                已选 <b>{selectedUrlIds.size}</b> 个URL
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) {
                      handleBatchOperation('change_frequency', { frequency: v },
                        `将选中的 ${selectedUrlIds.size} 个URL频率改为 ${FREQUENCY_LABELS[v]}？`)
                    }
                    e.target.value = ''
                  }}
                >
                  <option value="">批量改频率...</option>
                  {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select
                  className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) {
                      handleBatchOperation('change_status', { status: v },
                        `将选中的 ${selectedUrlIds.size} 个URL状态改为 ${STATUS_LABELS[v]?.label || v}？`)
                    }
                    e.target.value = ''
                  }}
                >
                  <option value="">批量改状态...</option>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <select
                  className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (v !== '') {
                      handleBatchOperation('move_to_group', { target_group_id: v },
                        `将选中的 ${selectedUrlIds.size} 个URL移动到 ${v === '' ? '未分组' : '新分组'}？`)
                    }
                    e.target.value = ''
                  }}
                >
                  <option value="">批量移动到...</option>
                  <option value="">（未分组）</option>
                  {allGroupOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleBatchOperation('delete_urls', {},
                    `确定删除选中的 ${selectedUrlIds.size} 个URL及其所有截图？此操作不可恢复！`)}
                  className="text-xs bg-red-500 text-white px-3 py-1.5 rounded hover:bg-red-600"
                >
                  批量删除
                </button>
                <button
                  onClick={() => { setSelectedUrlIds(new Set()) }}
                  className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-300"
                >
                  取消选择
                </button>
              </div>
            </div>
          )}

          {showAddForm && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-medium text-gray-800 mb-4">添加新URL</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="例如: 百度首页"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                    <input
                      type="url"
                      value={formData.url}
                      onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                      placeholder="https://example.com"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">分组</label>
                    <select
                      value={(selectedGroupId && selectedGroupId !== 'ungrouped') ? selectedGroupId : (formData.group_id === null ? '' : formData.group_id)}
                      onChange={(e) => setFormData({ ...formData, group_id: e.target.value === '' ? null : parseInt(e.target.value) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">（未分组）</option>
                      {allGroupOptions.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">截图频率</label>
                    <select
                      value={formData.frequency}
                      onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                        <option key={k}>{v}</option>
                      ))}
                    </select>
                    {currentGroup?.default_frequency && (
                      <p className="text-xs text-blue-600 mt-1">
                        分组默认: {FREQUENCY_LABELS[currentGroup.default_frequency]}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {loading ? '添加中...' : '添加'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm font-medium"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="grid gap-3">
            {urls.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
                暂无监控URL，点击右上角添加
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={selectedUrlIds.size === urls.length && urls.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-xs">全选</span>
                  </label>
                  <span className="text-xs text-gray-400">共 {urls.length} 个</span>
                </div>
                {urls.map((item) => {
                  const g = groups.find(gr => gr.id === item.group_id)
                  return (
                    <div
                      key={item.id}
                      className={`bg-white rounded-xl shadow-sm border p-4 hover:shadow-md transition-all
                        ${selectedUrlIds.has(item.id) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedUrlIds.has(item.id)}
                            onChange={(e) => toggleSelectUrl(item.id, e)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 w-4 h-4 rounded border-gray-300 flex-shrink-0"
                          />
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => navigate(`/url/${item.id}`)}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              {g && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{
                                    backgroundColor: `${g.color || '#6366f1'}20`,
                                    color: g.color || '#6366f1'
                                  }}
                                >
                                  📁 {g.name}
                                </span>
                              )}
                              <h3 className="text-base font-medium text-gray-900 hover:text-blue-600">
                                {item.name}
                              </h3>
                              {STATUS_LABELS[item.status] && (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABELS[item.status].color}`}>
                                  {STATUS_LABELS[item.status].label}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-1 truncate">{item.url}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs flex-wrap">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800">
                                {FREQUENCY_LABELS[item.frequency]}
                              </span>
                              <span className="text-gray-500">
                                截图数: <b className="text-gray-700">{item.screenshot_count}</b>
                              </span>
                              {item.last_screenshot_at && (
                                <span className="text-gray-500">
                                  上次: {dayjs(item.last_screenshot_at).format('YYYY-MM-DD HH:mm')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => handleScreenshot(item.id)}
                            disabled={screenshottingId === item.id}
                            className="bg-green-50 text-green-700 px-3 py-1.5 rounded-lg text-xs hover:bg-green-100 disabled:opacity-50"
                          >
                            {screenshottingId === item.id ? '...' : '截图'}
                          </button>
                          <button
                            onClick={() => handleDelete(item.id, item.name)}
                            className="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-xs hover:bg-red-100"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        {showStats && (
          <div className="col-span-12 xl:col-span-4">
            <div className="sticky top-4" style={{ maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
              <GroupStats selectedGroupId={selectedGroupId} />
            </div>
          </div>
        )}
      </div>

      <GroupDialog
        open={showGroupDialog}
        initialData={groupDialogData}
        onClose={() => setShowGroupDialog(false)}
        onSuccess={() => {
          loadGroups()
          loadUrls()
          loadCurrentGroup()
          window.__refreshGroupTree && window.__refreshGroupTree()
        }}
      />

      <GroupImportExport
        currentGroupId={selectedGroupId}
        onClose={() => setShowImportExport(false)}
        onSuccess={() => {
          loadGroups()
          loadUrls()
          window.__refreshGroupTree && window.__refreshGroupTree()
        }}
      />
    </div>
  )
}
