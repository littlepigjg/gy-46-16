import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import { getGroupStatsSummary, getGroupStatsDetails } from '../api.js'

const FREQUENCY_LABELS = {
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月'
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function BarChart({ data, maxValue, colorKey = 'color' }) {
  if (!data || data.length === 0) {
    return <div className="text-center text-gray-400 py-8 text-sm">暂无数据</div>
  }
  const max = maxValue || Math.max(...data.map(d => d.value || 0)) || 1
  return (
    <div className="space-y-2">
      {data.map((item, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div className="w-24 flex-shrink-0 truncate text-sm text-gray-700" title={item.label}>
            {item.label}
          </div>
          <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${((item.value || 0) / max) * 100}%`,
                backgroundColor: item[colorKey] || '#6366f1'
              }}
            />
            <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-gray-700">
              {item.value || 0} {item.unit || ''}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function GroupStats({ selectedGroupId }) {
  const [summary, setSummary] = useState(null)
  const [details, setDetails] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailPeriod, setDetailPeriod] = useState('7d')
  const [activeTab, setActiveTab] = useState('overview')

  const loadSummary = async () => {
    setLoadingSummary(true)
    try {
      const res = await getGroupStatsSummary()
      setSummary(res.data)
    } catch (err) {
      console.error('加载统计摘要失败:', err)
    } finally {
      setLoadingSummary(false)
    }
  }

  const loadDetails = async () => {
    if (!selectedGroupId || selectedGroupId === null || selectedGroupId === 'ungrouped') {
      setDetails(null)
      return
    }
    setLoadingDetails(true)
    try {
      const res = await getGroupStatsDetails(selectedGroupId, detailPeriod)
      setDetails(res.data)
    } catch (err) {
      console.error('加载详情失败:', err)
    } finally {
      setLoadingDetails(false)
    }
  }

  useEffect(() => {
    loadSummary()
  }, [])

  useEffect(() => {
    loadDetails()
  }, [selectedGroupId, detailPeriod])

  const StatCard = ({ title, value, subtitle, icon, color }) => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-gray-500">{subtitle}</p>}
        </div>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {icon}
        </div>
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">统计报表</h3>
        <button
          onClick={loadSummary}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
          title="刷新"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <div className="flex border-b border-gray-100 px-4">
        {[
          { key: 'overview', label: '概览' },
          { key: 'compare', label: '分组对比' },
          { key: 'detail', label: '单组详情' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            disabled={tab.key === 'detail' && (!selectedGroupId || selectedGroupId === 'ungrouped')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors
              ${activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 disabled:opacity-40'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                title="分组总数"
                value={summary?.total?.total_groups || 0}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>}
                color="#6366f1"
              />
              <StatCard
                title="URL总数"
                value={summary?.total?.total_urls || 0}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>}
                color="#3b82f6"
              />
              <StatCard
                title="截图总数"
                value={summary?.total?.total_screenshots || 0}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>}
                color="#22c55e"
              />
              <StatCard
                title="存储占用"
                value={formatBytes(summary?.total?.total_storage_bytes || 0)}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>}
                color="#f97316"
              />
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">URL数量排行</h4>
              {loadingSummary ? (
                <div className="text-center text-gray-400 py-4 text-sm">加载中...</div>
              ) : (
                <BarChart
                  data={(summary?.groups || []).map(g => ({
                    label: g.group_name,
                    value: g.url_count,
                    unit: '个',
                    color: '#6366f1'
                  })).slice(0, 8)}
                />
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">截图数量排行</h4>
              {loadingSummary ? (
                <div className="text-center text-gray-400 py-4 text-sm">加载中...</div>
              ) : (
                <BarChart
                  data={(summary?.groups || []).map(g => ({
                    label: g.group_name,
                    value: g.screenshot_count,
                    unit: '张',
                    color: '#22c55e'
                  })).slice(0, 8)}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === 'compare' && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-2 px-3 font-medium text-gray-700">分组</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-700">URL数</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-700">启用</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-700">截图数</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-700">存储</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-700">配额</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-700">使用率</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">最近活动</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingSummary ? (
                    <tr><td colSpan="8" className="text-center text-gray-400 py-8">加载中...</td></tr>
                  ) : (summary?.groups || []).length === 0 ? (
                    <tr><td colSpan="8" className="text-center text-gray-400 py-8">暂无分组数据</td></tr>
                  ) : (
                    (summary?.groups || []).map(g => {
                      const usedMb = (g.storage_used_bytes || 0) / (1024 * 1024)
                      const quotaMb = g.storage_quota_mb
                      const usage = quotaMb ? (usedMb / quotaMb) * 100 : null
                      const usageColor = usage === null ? 'gray'
                        : usage > 90 ? 'red'
                        : usage > 70 ? 'orange' : 'green'
                      return (
                        <tr key={g.group_id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: g.color || '#6366f1' }} />
                              <span className="font-medium text-gray-800">{g.group_name}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-700">{g.url_count}</td>
                          <td className="py-2 px-3 text-right text-green-600">{g.active_url_count}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{g.screenshot_count}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{formatBytes(g.storage_used_bytes)}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{quotaMb ? `${quotaMb} MB` : '∞'}</td>
                          <td className="py-2 px-3">
                            <div className="w-20 h-2 bg-gray-100 rounded-full mx-auto overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(usage || 0, 100)}%`,
                                  backgroundColor: usageColor === 'red' ? '#ef4444'
                                    : usageColor === 'orange' ? '#f97316'
                                    : usageColor === 'green' ? '#22c55e' : '#9ca3af'
                                }}
                              />
                            </div>
                            <div className={`text-center text-xs mt-1 text-${usageColor}-600`}>
                              {usage === null ? '-' : `${usage.toFixed(1)}%`}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-500">
                            {g.last_activity_at ? dayjs(g.last_activity_at).format('MM-DD HH:mm') : '-'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'detail' && selectedGroupId && selectedGroupId !== 'ungrouped' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">时间范围:</span>
              <select
                value={detailPeriod}
                onChange={(e) => setDetailPeriod(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="24h">近24小时</option>
                <option value="7d">近7天</option>
                <option value="30d">近30天</option>
                <option value="90d">近90天</option>
              </select>
            </div>

            {loadingDetails ? (
              <div className="text-center text-gray-400 py-8">加载中...</div>
            ) : details ? (
              <>
                <div>
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">每日截图趋势</h4>
                  {details.screenshots_by_day?.length > 0 ? (
                    <div className="space-y-1">
                      {[...details.screenshots_by_day].reverse().map(day => (
                        <div key={day.date} className="flex items-center gap-3 text-xs">
                          <span className="w-20 flex-shrink-0 text-gray-500">{day.date}</span>
                          <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden relative">
                            <div
                              className="h-full bg-blue-500 transition-all duration-500"
                              style={{
                                width: `${Math.min(100, (day.count / Math.max(...details.screenshots_by_day.map(d => d.count || 1))) * 100)}%`
                              }}
                            />
                            <span className="absolute inset-0 flex items-center px-2 text-white font-medium">
                              {day.count}张 · {formatBytes(day.size || 0)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-gray-400 py-4 text-sm">此时间段内无截图记录</div>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">频率分布</h4>
                  <BarChart
                    data={(details.frequency_distribution || []).map(f => ({
                      label: FREQUENCY_LABELS[f.frequency] || f.frequency,
                      value: f.count,
                      unit: '个',
                      color: '#8b5cf6'
                    }))}
                  />
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">状态分布</h4>
                  <BarChart
                    data={(details.status_distribution || []).map(s => ({
                      label: s.status === 'active' ? '启用' : (s.status === 'paused' ? '暂停' : s.status),
                      value: s.count,
                      unit: '个',
                      color: s.status === 'active' ? '#22c55e' : '#f97316'
                    }))}
                  />
                </div>
              </>
            ) : null}
          </div>
        )}

        {activeTab === 'detail' && (!selectedGroupId || selectedGroupId === 'ungrouped') && (
          <div className="text-center text-gray-400 py-12 text-sm">
            请先在左侧选择一个分组查看详情
          </div>
        )}
      </div>
    </div>
  )
}
