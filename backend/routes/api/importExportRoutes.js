import { Router } from 'express';
import getDb from '../../db.js';
import { getDescendantIds, validFrequencies } from '../utils/groupUtils.js';

const router = Router();

router.get('/groups/export', async (req, res) => {
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

router.post('/groups/import', async (req, res) => {
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

router.get('/templates', async (req, res) => {
  const db = await getDb();
  const templates = db.prepare('SELECT * FROM group_templates ORDER BY created_at DESC').all();
  res.json(templates);
});

router.post('/templates', async (req, res) => {
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

router.delete('/templates/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    db.prepare('DELETE FROM group_templates WHERE id = ? AND is_builtin = 0').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/templates/:id/apply', async (req, res) => {
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

export default router;
