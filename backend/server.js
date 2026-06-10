import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import getDb from './db.js';
import { startScheduler, triggerScreenshotNow } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

const validFrequencies = ['hourly', 'daily', 'weekly', 'monthly'];

function buildTree(groups, parentId = null) {
  const children = groups
    .filter(g => g.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order);
  return children.map(g => ({
    ...g,
    children: buildTree(groups, g.id)
  }));
}

function getDescendantIds(db, groupId, ids = []) {
  ids.push(groupId);
  const children = db.prepare('SELECT id FROM groups WHERE parent_id = ?').all(groupId);
  for (const c of children) {
    getDescendantIds(db, c.id, ids);
  }
  return ids;
}

app.get('/api/groups/tree', async (req, res) => {
  const db = await getDb();
  const groups = db.prepare('SELECT * FROM groups ORDER BY sort_order, id').all();
  const tree = buildTree(groups, null);
  res.json(tree);
});

app.get('/api/groups/list', async (req, res) => {
  const db = await getDb();
  const groups = db.prepare('SELECT * FROM groups ORDER BY sort_order, id').all();
  res.json(groups);
});

app.get('/api/groups/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!group) {
    return res.status(404).json({ error: '分组不存在' });
  }
  const urlCount = db.prepare('SELECT COUNT(*) as c FROM urls WHERE group_id = ?').get(id);
  const screenshotCount = db.prepare(`
    SELECT COUNT(*) as c FROM screenshots s
    JOIN urls u ON s.url_id = u.id
    WHERE u.group_id = ?
  `).get(id);
  res.json({ ...group, url_count: urlCount.c, screenshot_count: screenshotCount.c });
});

app.post('/api/groups', async (req, res) => {
  const {
    name, parent_id = null, description = '',
    default_frequency = 'daily', default_status = 'active',
    screenshot_strategy = null, storage_quota_mb = null,
    access_permissions = null, color = null, icon = null
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: '分组名称必填' });
  }
  if (!validFrequencies.includes(default_frequency)) {
    return res.status(400).json({ error: '无效的默认频率' });
  }

  try {
    const db = await getDb();
    if (parent_id !== null) {
      const parent = db.prepare('SELECT id FROM groups WHERE id = ?').get(parent_id);
      if (!parent) {
        return res.status(400).json({ error: '父分组不存在' });
      }
    }
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as max FROM groups WHERE parent_id IS ? OR parent_id = ?').get(parent_id === null ? null : parent_id, parent_id);
    const sort_order = (maxOrder.max || 0) + 1;

    const stmt = db.prepare(`
      INSERT INTO groups (name, parent_id, description, sort_order,
        default_frequency, default_status, screenshot_strategy,
        storage_quota_mb, access_permissions, color, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name, parent_id, description, sort_order,
      default_frequency, default_status, screenshot_strategy,
      storage_quota_mb, access_permissions, color, icon
    );

    const newGroup = db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newGroup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/groups/:id', async (req, res) => {
  const { id } = req.params;
  const updateFields = [
    'name', 'parent_id', 'description', 'sort_order',
    'is_collapsed', 'default_frequency', 'default_status',
    'screenshot_strategy', 'storage_quota_mb', 'access_permissions',
    'color', 'icon'
  ];

  try {
    const db = await getDb();
    const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '分组不存在' });
    }

    const sets = [];
    const params = [];
    for (const f of updateFields) {
      if (req.body[f] !== undefined) {
        if (f === 'default_frequency' && !validFrequencies.includes(req.body[f])) {
          return res.status(400).json({ error: '无效的默认频率' });
        }
        sets.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    }

    if (req.body.parent_id !== undefined) {
      const newParent = req.body.parent_id;
      if (newParent !== null) {
        const parent = db.prepare('SELECT id FROM groups WHERE id = ?').get(newParent);
        if (!parent) {
          return res.status(400).json({ error: '父分组不存在' });
        }
        const descendantIds = getDescendantIds(db, parseInt(id));
        if (descendantIds.includes(parseInt(newParent))) {
          return res.status(400).json({ error: '不能将分组移动到其自身或其子分组下' });
        }
      }
    }

    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      const sql = `UPDATE groups SET ${sets.join(', ')} WHERE id = ?`;
      params.push(id);
      db.prepare(sql).run(...params);
    }

    const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  const { id } = req.params;
  const { delete_urls = false } = req.query;
  try {
    const db = await getDb();
    const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(id);
    if (!group) {
      return res.status(404).json({ error: '分组不存在' });
    }
    const descendantIds = getDescendantIds(db, parseInt(id));

    if (delete_urls === 'true') {
      const allIds = descendantIds.join(',');
      const urls = db.prepare(`SELECT id FROM urls WHERE group_id IN (${allIds})`).all();
      for (const u of urls) {
        const screenshots = db.prepare('SELECT file_path FROM screenshots WHERE url_id = ?').all(u.id);
        screenshots.forEach(s => {
          if (fs.existsSync(s.file_path)) {
            fs.unlinkSync(s.file_path);
          }
        });
        db.prepare('DELETE FROM screenshots WHERE url_id = ?').run(u.id);
      }
      db.prepare(`DELETE FROM urls WHERE group_id IN (${allIds})`).run();
    } else {
      const allIds = descendantIds.join(',');
      db.prepare(`UPDATE urls SET group_id = NULL WHERE group_id IN (${allIds})`).run();
    }

    const placeholders = descendantIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM groups WHERE id IN (${placeholders})`).run(...descendantIds);
    res.json({ success: true, deleted_group_count: descendantIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups/:id/toggle-collapse', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    const group = db.prepare('SELECT is_collapsed FROM groups WHERE id = ?').get(id);
    if (!group) {
      return res.status(404).json({ error: '分组不存在' });
    }
    const newVal = group.is_collapsed ? 0 : 1;
    db.prepare('UPDATE groups SET is_collapsed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, id);
    res.json({ is_collapsed: newVal === 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups/reorder', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items 必须是数组' });
  }
  try {
    const db = await getDb();
    for (const item of items) {
      if (item.id !== undefined && item.sort_order !== undefined) {
        const parentId = item.parent_id !== undefined ? item.parent_id : null;
        db.prepare('UPDATE groups SET sort_order = ?, parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          item.sort_order, parentId, item.id
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups/:id/move', async (req, res) => {
  const { id } = req.params;
  const { target_parent_id, target_sort_order } = req.body;
  try {
    const db = await getDb();
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!group) {
      return res.status(404).json({ error: '分组不存在' });
    }
    if (target_parent_id !== undefined && target_parent_id !== null) {
      const target = db.prepare('SELECT id FROM groups WHERE id = ?').get(target_parent_id);
      if (!target) {
        return res.status(400).json({ error: '目标分组不存在' });
      }
      const descendantIds = getDescendantIds(db, parseInt(id));
      if (descendantIds.includes(parseInt(target_parent_id))) {
        return res.status(400).json({ error: '不能移动到自身或子分组下' });
      }
    }
    const finalParent = target_parent_id !== undefined ? target_parent_id : group.parent_id;
    const finalOrder = target_sort_order !== undefined ? target_sort_order : group.sort_order;
    db.prepare('UPDATE groups SET parent_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      finalParent, finalOrder, id
    );
    const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups/:id/urls', async (req, res) => {
  const { id } = req.params;
  const { include_subgroups = 'true' } = req.query;
  try {
    const db = await getDb();
    let groupIds = [parseInt(id)];
    if (include_subgroups === 'true') {
      groupIds = getDescendantIds(db, parseInt(id));
    }
    const placeholders = groupIds.map(() => '?').join(',');
    const urls = db.prepare(`
      SELECT u.*,
        (SELECT COUNT(*) FROM screenshots s WHERE s.url_id = u.id) as screenshot_count
      FROM urls u
      WHERE u.group_id IN (${placeholders})
      ORDER BY u.created_at DESC
    `).all(...groupIds);
    res.json(urls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups/:id/batch-screenshot', async (req, res) => {
  const { id } = req.params;
  const { include_subgroups = true } = req.body || {};
  try {
    const db = await getDb();
    let groupIds = [parseInt(id)];
    if (include_subgroups) {
      groupIds = getDescendantIds(db, parseInt(id));
    }
    const placeholders = groupIds.map(() => '?').join(',');
    const urls = db.prepare(`SELECT * FROM urls WHERE group_id IN (${placeholders}) AND status = 'active'`).all(...groupIds);
    const results = [];
    for (const urlRecord of urls) {
      try {
        const r = await triggerScreenshotNow(urlRecord.id);
        results.push({ id: urlRecord.id, success: true, result: r });
      } catch (e) {
        results.push({ id: urlRecord.id, success: false, error: e.message });
      }
    }
    res.json({ total: urls.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups/batch-operation', async (req, res) => {
  const { group_ids, operation, data, include_subgroups = true } = req.body;
  if (!Array.isArray(group_ids) || !operation) {
    return res.status(400).json({ error: 'group_ids 和 operation 必填' });
  }
  try {
    const db = await getDb();
    let allGroupIds = [...group_ids];
    if (include_subgroups) {
      const expanded = new Set();
      for (const gid of group_ids) {
        getDescendantIds(db, parseInt(gid)).forEach(id => expanded.add(id));
      }
      allGroupIds = Array.from(expanded);
    }
    const placeholders = allGroupIds.map(() => '?').join(',');

    if (operation === 'change_frequency') {
      if (!data?.frequency || !validFrequencies.includes(data.frequency)) {
        return res.status(400).json({ error: '无效的频率' });
      }
      db.prepare(`UPDATE urls SET frequency = ? WHERE group_id IN (${placeholders})`).run(data.frequency, ...allGroupIds);
    } else if (operation === 'change_status') {
      const status = data?.status || 'paused';
      db.prepare(`UPDATE urls SET status = ? WHERE group_id IN (${placeholders})`).run(status, ...allGroupIds);
    } else if (operation === 'move_to_group') {
      const targetGroupId = data?.target_group_id;
      db.prepare(`UPDATE urls SET group_id = ? WHERE group_id IN (${placeholders})`).run(targetGroupId, ...allGroupIds);
    } else if (operation === 'delete_urls') {
      const urls = db.prepare(`SELECT id FROM urls WHERE group_id IN (${placeholders})`).all(...allGroupIds);
      for (const u of urls) {
        const screenshots = db.prepare('SELECT file_path FROM screenshots WHERE url_id = ?').all(u.id);
        screenshots.forEach(s => { if (fs.existsSync(s.file_path)) fs.unlinkSync(s.file_path); });
        db.prepare('DELETE FROM screenshots WHERE url_id = ?').run(u.id);
      }
      db.prepare(`DELETE FROM urls WHERE group_id IN (${placeholders})`).run(...allGroupIds);
    } else {
      return res.status(400).json({ error: '未知操作' });
    }
    res.json({ success: true, affected_groups: allGroupIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups/export', async (req, res) => {
  const { group_id, include_urls = 'true', include_subgroups = 'true' } = req.query;
  try {
    const db = await getDb();
    let groupIds = [];
    if (group_id) {
      if (include_subgroups === 'true') {
        groupIds = getDescendantIds(db, parseInt(group_id));
      } else {
        groupIds = [parseInt(group_id)];
      }
    } else {
      groupIds = db.prepare('SELECT id FROM groups').all().map(g => g.id);
    }
    const placeholders = groupIds.map(() => '?').join(',');
    const groups = db.prepare(`SELECT * FROM groups WHERE id IN (${placeholders})`).all(...groupIds);
    let urls = [];
    if (include_urls === 'true') {
      urls = db.prepare(`SELECT id, group_id, url, name, frequency, status, custom_config FROM urls WHERE group_id IN (${placeholders})`).all(...groupIds);
    }
    res.json({
      version: 1, exported_at: new Date().toISOString(),
      groups, urls
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups/import', async (req, res) => {
  const { data, target_parent_id = null, mode = 'copy' } = req.body;
  if (!data || !data.groups) {
    return res.status(400).json({ error: '导入数据格式错误' });
  }
  try {
    const db = await getDb();
    const idMap = {};
    const createdGroups = [];
    const createdUrls = [];
    const sortedGroups = [...data.groups].sort((a, b) => {
      if (a.parent_id === null) return -1;
      if (b.parent_id === null) return 1;
      return 0;
    });
    for (const g of sortedGroups) {
      const newParent = g.parent_id !== null && idMap[g.parent_id] ? idMap[g.parent_id] : (target_parent_id);
      const stmt = db.prepare(`
        INSERT INTO groups (name, parent_id, description, sort_order,
          default_frequency, default_status, screenshot_strategy,
          storage_quota_mb, access_permissions, color, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as max FROM groups WHERE parent_id IS ? OR parent_id = ?').get(newParent === null ? null : newParent, newParent);
      const sort_order = mode === 'copy' ? (maxOrder.max || 0) + 1 : (g.sort_order || 0);
      const result = stmt.run(
        mode === 'copy' ? `${g.name} (副本)` : g.name,
        newParent, g.description || '', sort_order,
        g.default_frequency || 'daily', g.default_status || 'active',
        g.screenshot_strategy || null, g.storage_quota_mb || null,
        g.access_permissions || null, g.color || null, g.icon || null
      );
      idMap[g.id] = result.lastInsertRowid;
      createdGroups.push(result.lastInsertRowid);
    }
    if (data.urls) {
      for (const u of data.urls) {
        const newGroupId = u.group_id !== null && idMap[u.group_id] ? idMap[u.group_id] : null;
        try {
          const existing = db.prepare('SELECT id FROM urls WHERE url = ?').get(u.url);
          if (existing) {
            db.prepare('UPDATE urls SET group_id = COALESCE(?, group_id) WHERE id = ?').run(newGroupId, existing.id);
            createdUrls.push(existing.id);
          } else {
            const stmt = db.prepare(`
              INSERT INTO urls (group_id, url, name, frequency, status, custom_config)
              VALUES (?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(newGroupId, u.url, u.name, u.frequency || 'daily', u.status || 'active', u.custom_config || null);
            createdUrls.push(result.lastInsertRowid);
          }
        } catch (e) {
            console.warn('导入URL跳过:', u.url, e.message);
          }
      }
    }
    res.json({ success: true, created_groups: createdGroups.length, created_urls: createdUrls.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/templates', async (req, res) => {
  const db = await getDb();
  const templates = db.prepare('SELECT * FROM group_templates ORDER BY created_at DESC').all();
  res.json(templates);
});

app.post('/api/templates', async (req, res) => {
  const { name, description = '', template_data } = req.body;
  if (!name || !template_data) {
    return res.status(400).json({ error: '名称和模板数据必填' });
  }
  try {
    const db = await getDb();
    const stmt = db.prepare('INSERT INTO group_templates (name, description, template_data) VALUES (?, ?, ?)');
    const result = stmt.run(name, description, JSON.stringify(template_data));
    const tpl = db.prepare('SELECT * FROM group_templates WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(tpl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    db.prepare('DELETE FROM group_templates WHERE id = ? AND is_builtin = 0').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates/:id/apply', async (req, res) => {
  const { id } = req.params;
  const { target_group_id = null } = req.body;
  try {
    const db = await getDb();
    const tpl = db.prepare('SELECT * FROM group_templates WHERE id = ?').get(id);
    if (!tpl) {
      return res.status(404).json({ error: '模板不存在' });
    }
    const templateData = JSON.parse(tpl.template_data);
    const idMap = {};
    const createdGroups = [];
    const sortedGroups = [...(templateData.groups || [])];
    for (const g of sortedGroups) {
      const newParent = g.parent_id !== null && idMap[g.parent_id] ? idMap[g.parent_id] : target_group_id;
      const stmt = db.prepare(`
        INSERT INTO groups (name, parent_id, description, sort_order,
          default_frequency, default_status, screenshot_strategy,
          storage_quota_mb, access_permissions, color, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        g.name, newParent, g.description || '', g.sort_order || 0,
        g.default_frequency || 'daily', g.default_status || 'active',
        g.screenshot_strategy || null, g.storage_quota_mb || null,
        g.access_permissions || null, g.color || null, g.icon || null
      );
      idMap[g.id] = result.lastInsertRowid;
      createdGroups.push(result.lastInsertRowid);
    }
    res.json({ success: true, created_groups: createdGroups.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups/stats/summary', async (req, res) => {
  try {
    const db = await getDb();
    const groups = db.prepare('SELECT * FROM groups ORDER BY sort_order').all();
    const stats = [];
    for (const g of groups) {
      const descendantIds = getDescendantIds(db, g.id);
      const placeholders = descendantIds.map(() => '?').join(',');
      const urlCount = db.prepare(`SELECT COUNT(*) as c FROM urls WHERE group_id IN (${placeholders})`).get(...descendantIds);
      const screenshotCount = db.prepare(`
        SELECT COUNT(*) as c FROM screenshots s JOIN urls u ON s.url_id = u.id WHERE u.group_id IN (${placeholders})`).get(...descendantIds);
      const storageUsed = db.prepare(`
        SELECT COALESCE(SUM(s.file_size_bytes), 0) as total FROM screenshots s
        JOIN urls u ON s.url_id = u.id
        WHERE u.group_id IN (${placeholders})
      `).get(...descendantIds);
      const lastActivity = db.prepare(`
        SELECT MAX(s.created_at) as last FROM screenshots s
        JOIN urls u ON s.url_id = u.id
        WHERE u.group_id IN (${placeholders})
      `).get(...descendantIds);
      const activeUrls = db.prepare(`SELECT COUNT(*) as c FROM urls WHERE status = 'active' AND group_id IN (${placeholders})`).get(...descendantIds);
      stats.push({
        group_id: g.id,
        group_name: g.name,
        url_count: urlCount.c,
        active_url_count: activeUrls.c,
        screenshot_count: screenshotCount.c,
        storage_used_bytes: storageUsed.total || 0,
        storage_quota_mb: g.storage_quota_mb,
        last_activity_at: lastActivity.last,
        default_frequency: g.default_frequency
      });
    }
    const total = {
      total_groups: groups.length,
      total_urls: db.prepare('SELECT COUNT(*) as c FROM urls').get().c,
      total_screenshots: db.prepare('SELECT COUNT(*) as c FROM screenshots').get().c,
      total_storage_bytes: db.prepare('SELECT COALESCE(SUM(file_size_bytes)), 0) as total FROM screenshots').get().total || 0
    };
    res.json({ groups: stats, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups/:id/stats/details', async (req, res) => {
  const { id } = req.params;
  const { period = '7d' } = req.query;
  try {
    const db = await getDb();
    const descendantIds = getDescendantIds(db, parseInt(id));
    const placeholders = descendantIds.map(() => '?').join(',');
    const days = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const screenshotsByDay = db.prepare(`
      SELECT DATE(s.created_at) as date, COUNT(*) as count, COALESCE(SUM(s.file_size_bytes)) as size
      FROM screenshots s
      JOIN urls u ON s.url_id = u.id
      WHERE u.group_id IN (${placeholders})
        AND s.created_at >= datetime('now', ?)
      GROUP BY DATE(s.created_at)
      ORDER BY date DESC
    `).all(...descendantIds, `-${days} days`);
    const freqDistribution = db.prepare(`
      SELECT u.frequency, COUNT(*) as count
      FROM urls u
      WHERE u.group_id IN (${placeholders})
      GROUP BY u.frequency
    `).all(...descendantIds);
    const statusDistribution = db.prepare(`
      SELECT u.status, COUNT(*) as count
      FROM urls u
      WHERE u.group_id IN (${placeholders})
      GROUP BY u.status
    `).all(...descendantIds);
    res.json({
      screenshots_by_day: screenshotsByDay,
      frequency_distribution: freqDistribution,
      status_distribution: statusDistribution
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/urls', async (req, res) => {
  const db = await getDb();
  const { group_id } = req.query;
  let sql = `
    SELECT u.*,
      (SELECT COUNT(*) FROM screenshots s WHERE s.url_id = u.id) as screenshot_count
    FROM urls u
  `;
  const params = [];
  if (group_id !== undefined) {
    if (group_id === 'null' || group_id === '') {
      sql += ' WHERE u.group_id IS NULL';
    } else {
      sql += ' WHERE u.group_id = ?';
      params.push(group_id);
    }
  }
  sql += ' ORDER BY u.created_at DESC';
  const urls = db.prepare(sql).all(...params);
  res.json(urls);
});

app.post('/api/urls', async (req, res) => {
  const { url, name, frequency = 'daily', group_id = null, custom_config = null } = req.body;

  if (!url || !name) {
    return res.status(400).json({ error: 'URL和名称必填' });
  }
  if (!validFrequencies.includes(frequency)) {
    return res.status(400).json({ error: '无效的频率' });
  }
  let finalFrequency = frequency;
  let finalStatus = 'active';
  if (group_id !== null) {
    const db = await getDb();
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(group_id);
    if (group) {
      finalFrequency = group.default_frequency || finalFrequency;
      finalStatus = group.default_status || finalStatus;
    }
  }

  try {
    const db = await getDb();
    const stmt = db.prepare('INSERT INTO urls (group_id, url, name, frequency, status, custom_config) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(group_id, url, name, finalFrequency, finalStatus, custom_config ? JSON.stringify(custom_config) : null);

    const newUrl = db.prepare('SELECT * FROM urls WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newUrl);
  } catch (err) {
    if (err.message.includes('UNIQUE') || err.message.includes('unique')) {
      res.status(400).json({ error: '该URL已存在' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.delete('/api/urls/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();

  const screenshots = db.prepare('SELECT file_path FROM screenshots WHERE url_id = ?').all(id);
  screenshots.forEach(s => {
    if (fs.existsSync(s.file_path)) {
      fs.unlinkSync(s.file_path);
      const dir = path.dirname(s.file_path);
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch (e) {}
    }
  });

  db.prepare('DELETE FROM screenshots WHERE url_id = ?').run(id);
  const stmt = db.prepare('DELETE FROM urls WHERE id = ?');
  stmt.run(id);
  res.json({ success: true });
});

app.put('/api/urls/:id', async (req, res) => {
  const { id } = req.params;
  const { name, frequency, status, group_id, custom_config } = req.body;
  const db = await getDb();

  const existing = db.prepare('SELECT * FROM urls WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'URL不存在' });
  }

  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (frequency !== undefined) {
    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({ error: '无效的频率' });
    }
    sets.push('frequency = ?'); params.push(frequency);
  }
  if (status !== undefined) { sets.push('status = ?'); params.push(status); }
  if (group_id !== undefined) { sets.push('group_id = ?'); params.push(group_id === '' || group_id === null ? null : group_id); }
  if (custom_config !== undefined) { sets.push('custom_config = ?'); params.push(custom_config ? JSON.stringify(custom_config) : null); }

  if (sets.length > 0) {
    const sql = `UPDATE urls SET ${sets.join(', ')} WHERE id = ?`;
    params.push(id);
    db.prepare(sql).run(...params);
  }

  const updated = db.prepare('SELECT * FROM urls WHERE id = ?').get(id);
  res.json(updated);
});

app.get('/api/urls/:id/screenshots', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshots = db.prepare(`
    SELECT * FROM screenshots
    WHERE url_id = ?
    ORDER BY created_at DESC
  `).all(id);
  res.json(screenshots);
});

app.get('/api/screenshots/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshot = db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id);
  if (!screenshot) {
    return res.status(404).json({ error: '截图不存在' });
  }
  res.json(screenshot);
});

app.delete('/api/screenshots/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshot = db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id);
  if (!screenshot) {
    return res.status(404).json({ error: '截图不存在' });
  }

  if (fs.existsSync(screenshot.file_path)) {
    fs.unlinkSync(screenshot.file_path);
  }

  db.prepare('DELETE FROM screenshots WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/urls/:id/screenshot', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await triggerScreenshotNow(parseInt(id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/urls/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const url = db.prepare('SELECT * FROM urls WHERE id = ?').get(id);
  if (!url) {
    return res.status(404).json({ error: 'URL不存在' });
  }
  res.json(url);
});

app.listen(PORT, async () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
  await getDb();
  startScheduler();
});
