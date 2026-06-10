import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
})

export const getUrls = (params) => api.get('/urls', { params })
export const addUrl = (data) => api.post('/urls', data)
export const deleteUrl = (id) => api.delete(`/urls/${id}`)
export const updateUrl = (id, data) => api.put(`/urls/${id}`, data)
export const getUrl = (id) => api.get(`/urls/${id}`)
export const getScreenshots = (urlId) => api.get(`/urls/${urlId}/screenshots`)
export const deleteScreenshot = (id) => api.delete(`/screenshots/${id}`)
export const triggerScreenshot = (urlId) => api.post(`/urls/${urlId}/screenshot`)

export const getGroupTree = () => api.get('/groups/tree')
export const getGroupList = () => api.get('/groups/list')
export const getGroup = (id) => api.get(`/groups/${id}`)
export const createGroup = (data) => api.post('/groups', data)
export const updateGroup = (id, data) => api.put(`/groups/${id}`, data)
export const deleteGroup = (id, deleteUrls = false) => api.delete(`/groups/${id}`, { params: { delete_urls: deleteUrls } })
export const toggleGroupCollapse = (id) => api.post(`/groups/${id}/toggle-collapse`)
export const reorderGroups = (items) => api.post('/groups/reorder', { items })
export const moveGroup = (id, target_parent_id, target_sort_order) => api.post(`/groups/${id}/move`, { target_parent_id, target_sort_order })

export const getGroupUrls = (id, includeSubgroups = true) => api.get(`/groups/${id}/urls`, { params: { include_subgroups: includeSubgroups } })
export const batchGroupScreenshot = (id, includeSubgroups = true) => api.post(`/groups/${id}/batch-screenshot`, { include_subgroups: includeSubgroups })
export const batchGroupOperation = (group_ids, operation, data, includeSubgroups = true) => api.post('/groups/batch-operation', { group_ids, operation, data, include_subgroups: includeSubgroups })

export const exportGroups = (group_id, include_urls = true, include_subgroups = true) => api.get('/groups/export', { params: { group_id, include_urls, include_subgroups } })
export const importGroups = (data, target_parent_id = null, mode = 'copy') => api.post('/groups/import', { data, target_parent_id, mode })

export const getTemplates = () => api.get('/templates')
export const createTemplate = (name, description, template_data) => api.post('/templates', { name, description, template_data })
export const deleteTemplate = (id) => api.delete(`/templates/${id}`)
export const applyTemplate = (id, target_group_id = null) => api.post(`/templates/${id}/apply`, { target_group_id })

export const getGroupStatsSummary = () => api.get('/groups/stats/summary')
export const getGroupStatsDetails = (id, period = '7d') => api.get(`/groups/${id}/stats/details`, { params: { period } })

export default api
