import { useState, useEffect } from 'react'
import {
  exportGroups, importGroups, getTemplates,
  createTemplate, deleteTemplate, applyTemplate, getGroupList
} from '../api.js'

export default function GroupImportExport({
  currentGroupId,
  onSuccess,
  onClose
}) {
  const [activeTab, setActiveTab] = useState('export')
  const [exportUrl, setExportUrl] = useState(true)
  const [exportSubgroups, setExportSubgroups] = useState(true)
  const [exportSpecificGroup, setExportSpecificGroup] = useState(false)
  const [importMode, setImportMode] = useState('copy')
  const [importTargetParent, setImportTargetParent] = useState(null)
  const [importFile, setImportFile] = useState(null)
  const [importData, setImportData] = useState(null)
  const [templates, setTemplates] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateDesc, setNewTemplateDesc] = useState('')

  const loadTemplates = async () => {
    try {
      const [tplRes, grpRes] = await Promise.all([getTemplates(), getGroupList()])
      setTemplates(tplRes.data)
      setGroups(grpRes.data)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  const handleExport = async () => {
    setLoading(true)
    try {
      const gid = exportSpecificGroup ? currentGroupId : undefined
      const res = await exportGroups(gid, exportUrl, exportSubgroups)
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      a.download = `groups-export-${ts}.json`
      a.click()
      URL.revokeObjectURL(url)
      onSuccess && onSuccess()
    } catch (err) {
      alert('导出失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.groups) throw new Error('格式不正确')
        setImportData(data)
      } catch (e) {
        alert('文件格式错误')
        setImportFile(null)
        setImportData(null)
      }
    }
    reader.readAsText(file)
  }

  const handleImport = async () => {
    if (!importData) return
    setLoading(true)
    try {
      await importGroups(importData, importTargetParent, importMode)
      alert('导入成功')
      onSuccess && onSuccess()
    } catch (err) {
      alert('导入失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim()) {
      alert('请输入模板名称')
      return
    }
    setLoading(true)
    try {
      const gid = exportSpecificGroup ? currentGroupId : undefined
      const res = await exportGroups(gid, exportUrl, exportSubgroups)
      await createTemplate(newTemplateName.trim(), newTemplateDesc.trim(), res.data)
      setNewTemplateName('')
      setNewTemplateDesc('')
      await loadTemplates()
    } catch (err) {
      alert('创建模板失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleApplyTemplate = async (tpl) => {
    if (!confirm(`确认应用模板 "${tpl.name}" 吗？\n将按照模板创建新的分组结构。`)) return
    setLoading(true)
    try {
      await applyTemplate(tpl.id, importTargetParent)
      alert('模板应用成功')
      onSuccess && onSuccess()
    } catch (err) {
      alert('应用失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteTemplate = async (tpl) => {
    if (tpl.is_builtin) {
      alert('内置模板不可删除')
      return
    }
    if (!confirm(`确认删除模板 "${tpl.name}" 吗？`)) return
    setLoading(true)
    try {
      await deleteTemplate(tpl.id)
      await loadTemplates()
    } catch (err) {
      alert('删除失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const flatOptions = (list, parentId = null, level = 0) => {
    const result = []
    const children = list.filter(g => g.parent_id === parentId)
    children.sort((a, b) => a.sort_order - b.sort_order).forEach(g => {
      result.push({
        id: g.id,
        label: `${'　'.repeat(level)}${level > 0 ? '└ ' : ''}${g.name}`
      })
      result.push(...flatOptions(list, g.id, level + 1))
    })
    return result
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">导入导出 & 模板</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-gray-100 px-6">
          {[
            { key: 'export', label: '导出' },
            { key: 'import', label: '导入' },
            { key: 'templates', label: '模板' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); if (tab.key === 'templates' || tab.key === 'import') loadTemplates() }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  导出内容将保存为 JSON 文件，可用于备份或迁移到其他环境
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportSpecificGroup}
                  onChange={(e) => setExportSpecificGroup(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">仅导出当前选中的分组</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportSubgroups}
                  onChange={(e) => setExportSubgroups(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">包含子分组</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportUrl}
                  onChange={(e) => setExportUrl(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">包含URL列表</span>
              </label>

              <button
                onClick={handleExport}
                disabled={loading || (exportSpecificGroup && (!currentGroupId || currentGroupId === 'ungrouped'))}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {loading ? '导出中...' : '下载 JSON 文件'}
              </button>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">导入文件</label>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileSelect}
                  className="w-full text-sm text-gray-600
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-medium
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100
                    border border-gray-300 rounded-lg p-2"
                />
                {importFile && (
                  <div className="mt-2 text-sm text-gray-600">
                    ✓ 已选择: {importFile.name}
                    {importData && (
                      <span className="text-gray-500">
                        （含 {importData.groups?.length || 0} 个分组，{importData.urls?.length || 0} 个URL）
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">导入方式</label>
                <select
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="copy">复制模式（名称后附加副本标识）</option>
                  <option value="merge">合并模式（保留原名）</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">导入到父分组（可选）</label>
                <select
                  value={importTargetParent === null ? '' : importTargetParent}
                  onChange={(e) => setImportTargetParent(e.target.value === '' ? null : parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">（根分组）</option>
                  {flatOptions(groups).map(opt => (
                    <option key={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleImport}
                disabled={loading || !importData}
                className="w-full py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
              >
                {loading ? '导入中...' : '执行导入'}
              </button>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-5">
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-800 mb-3">创建新模板</h4>
                <p className="text-xs text-gray-500 mb-3">将当前分组结构保存为模板，便于快速复用</p>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="模板名称 *"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <textarea
                    value={newTemplateDesc}
                    onChange={(e) => setNewTemplateDesc(e.target.value)}
                    rows="2"
                    placeholder="模板描述（可选）"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <div className="flex flex-wrap gap-3 items-center text-sm">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exportSpecificGroup}
                        onChange={(e) => setExportSpecificGroup(e.target.checked)}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-gray-600">仅当前分组</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exportUrl}
                        onChange={(e) => setExportUrl(e.target.checked)}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-gray-600">包含URL</span>
                    </label>
                  </div>
                  <button
                    onClick={handleCreateTemplate}
                    disabled={loading}
                    className="w-full py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {loading ? '创建中...' : '保存模板'}
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">可用模板</h4>
                {templates.length === 0 ? (
                  <div className="text-center text-gray-400 py-6 text-sm border border-dashed border-gray-200 rounded-xl">
                    暂无模板
                  </div>
                ) : (
                  <div className="space-y-2">
                    {templates.map(tpl => (
                      <div key={tpl.id} className="border border-gray-200 rounded-xl p-3 hover:border-blue-300 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h5 className="font-medium text-gray-800 text-sm">{tpl.name}</h5>
                              {tpl.is_builtin && (
                                <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">内置</span>
                              )}
                            </div>
                            {tpl.description && (
                              <p className="text-xs text-gray-500 mt-1">{tpl.description}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-1">
                              创建于 {new Date(tpl.created_at).toLocaleString('zh-CN')}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleApplyTemplate(tpl)}
                              disabled={loading}
                              className="px-2.5 py-1 rounded-lg text-xs bg-green-50 text-green-700 hover:bg-green-100"
                            >
                              应用
                            </button>
                            {!tpl.is_builtin && (
                              <button
                                onClick={() => handleDeleteTemplate(tpl)}
                                disabled={loading}
                                className="px-2.5 py-1 rounded-lg text-xs bg-red-50 text-red-700 hover:bg-red-100"
                              >
                                删除
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 text-sm font-medium"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
