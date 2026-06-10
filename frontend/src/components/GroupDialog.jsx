import { useState, useEffect } from 'react'
import { createGroup, updateGroup, getGroupList } from '../api.js'

const FREQUENCY_LABELS = {
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月'
}

const STRATEGY_OPTIONS = [
  { value: 'default', label: '默认策略（全页截图）' },
  { value: 'viewport', label: '仅视口区域' },
  { value: 'above_fold', label: '首屏内容' },
  { value: 'full_page_delay', label: '全页截图（含延迟等待）' }
]

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
]

function buildFlatOptions(groups, parentId = null, level = 0) {
  const result = []
  const children = groups.filter(g => g.parent_id === parentId)
  children.sort((a, b) => a.sort_order - b.sort_order).forEach(g => {
    result.push({
      id: g.id,
      label: `${'　'.repeat(level)}${level > 0 ? '└ ' : ''}${g.name}`
    })
    result.push(...buildFlatOptions(groups, g.id, level + 1))
  });
  return result
}

export default function GroupDialog({ open, initialData, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    name: '',
    parent_id: null,
    description: '',
    color: '#6366f1',
    icon: '',
    default_frequency: 'daily',
    default_status: 'active',
    screenshot_strategy: 'default',
    storage_quota_mb: null,
    access_permissions: '',
    sort_order: 0
  })
  const [activeTab, setActiveTab] = useState('basic')
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('create')
  const [editingId, setEditingId] = useState(null)

  const loadGroups = async () => {
    try {
      const res = await getGroupList()
      setGroups(res.data)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (open) {
      loadGroups()
      if (initialData?.mode === 'edit' && initialData?.group) {
        const g = initialData.group
        setMode('edit')
        setEditingId(g.id)
        setFormData({
          name: g.name || '',
          parent_id: g.parent_id,
          description: g.description || '',
          color: g.color || '#6366f1',
          icon: g.icon || '',
          default_frequency: g.default_frequency || 'daily',
          default_status: g.default_status || 'active',
          screenshot_strategy: g.screenshot_strategy || 'default',
          storage_quota_mb: g.storage_quota_mb,
          access_permissions: g.access_permissions || '',
          sort_order: g.sort_order || 0
        })
      } else {
        setMode('create')
        setEditingId(null)
        setFormData(prev => ({
          ...prev,
          name: '',
          parent_id: initialData?.parent_id ?? null,
          description: '',
          color: '#6366f1',
          icon: '',
          default_frequency: 'daily',
          default_status: 'active',
          screenshot_strategy: 'default',
          storage_quota_mb: null,
          access_permissions: '',
          sort_order: 0
        }))
      }
      setActiveTab('basic')
    }
  }, [open, initialData])

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      alert('请输入分组名称')
      return
    }
    setLoading(true)
    try {
      if (mode === 'create') {
        await createGroup({
          ...formData,
          parent_id: formData.parent_id === '' ? null : formData.parent_id
        })
      } else {
        await updateGroup(editingId, {
          ...formData,
          parent_id: formData.parent_id === '' ? null : formData.parent_id
        })
      }
      onSuccess && onSuccess()
      onClose && onClose()
    } catch (err) {
      alert('保存失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const parentOptions = buildFlatOptions(groups.filter(g => editingId ? g.id !== editingId : true))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'create' ? '新建分组' : '编辑分组'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-gray-100 px-6">
          {[
            { key: 'basic', label: '基本信息' },
            { key: 'defaults', label: '默认参数' },
            { key: 'strategy', label: '策略配置' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-4">
            {activeTab === 'basic' && (
              <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  分组名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如：电商网站监控"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">父分组</label>
                <select
                  value={formData.parent_id === null ? '' : formData.parent_id}
                  onChange={(e) => setFormData({ ...formData, parent_id: e.target.value === '' ? null : parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">（根分组）</option>
                  {parentOptions.map(opt => (
                    <option key={opt.id} disabled={mode === 'edit' && editingId === opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">选择父分组，留空表示创建为根分组</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder="分组用途说明..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">标识颜色</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map(color => (
                    <button
                    key={color}
                    type="button"
                    onClick={() => setFormData({ ...formData, color })}
                    className={`w-8 h-8 rounded-full ring-offset-2 transition-transform
                      ${formData.color === color ? 'ring-2 ring-offset-2 scale-110' : ''}`}
                    style={{ backgroundColor: color, ringColor: color }}
                  />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">排序号</label>
                <input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">数字越小越靠前，同级分组内的排序</p>
              </div>
            </div>
          )}

          {activeTab === 'defaults' && (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800">
                  <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  新建URL时会自动继承本组默认参数，已有URL不受影响
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">默认截图频率</label>
                <select
                  value={formData.default_frequency}
                  onChange={(e) => setFormData({ ...formData, default_frequency: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">默认状态</label>
                <select
                  value={formData.default_status}
                  onChange={(e) => setFormData({ ...formData, default_status: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">启用（自动截图）</option>
                  <option value="paused">暂停（不自动截图）</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'strategy' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">截图策略</label>
                <select
                  value={formData.screenshot_strategy || 'default'}
                  onChange={(e) => setFormData({ ...formData, screenshot_strategy: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {STRATEGY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">定义本组URL的截图方式</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">存储配额 (MB)</label>
                <input
                  type="number"
                  value={formData.storage_quota_mb === null ? '' : formData.storage_quota_mb}
                  onChange={(e) => {
                    const val = e.target.value
                    setFormData({ ...formData, storage_quota_mb: val === '' ? null : parseInt(val) })
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="留空表示不限制"
                />
                <p className="text-xs text-gray-500 mt-1">本组所有截图文件的总存储上限</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">访问权限</label>
                <textarea
                  value={formData.access_permissions}
                  onChange={(e) => setFormData({ ...formData, access_permissions: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder="例如：admin,editor"
                />
                <p className="text-xs text-gray-500 mt-1">可访问此分组的用户/角色，逗号分隔，留空表示全部可访问</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 text-sm font-medium"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? '保存中...' : (mode === 'create' ? '创建' : '保存修改')}
          </button>
        </div>
        </form>
      </div>
    </div>
  )
}
