import { Router } from 'express';
import fs from 'fs';
import getDb from '../../db.js';
import { buildTree, getDescendantIds, validFrequencies } from '../utils/groupUtils.js';
import { triggerScreenshotNow } from '../../scheduler.js';

const router = Router();

router.get('/groups/tree', async (req, res) => {
  const db = await getDb();
  const groups = db.prepare('SELECT * FROM groups ORDER BY sort_order, id').all();
  const tree = buildTree(groups, null);
  res.json(tree);
});

router.get('/groups/list', async (req, res) => {
  const db = await getDb();
  const groups = db.prepare('SELECT * FROM groups ORDER BY sort_order, id').all();
  res.json(groups);
});

router.get('/groups/:id', async (req, res) => {
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

router.post('/groups', async (req, res) => {
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

router.put('/groups/:id', async (req, res) => {
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

router.delete('/groups/:id', async (req, res) => {
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

router.post('/groups/:id/toggle-collapse', async (req, res) => {
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

router.post('/groups/reorder', async (req, res) => {
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

router.post('/groups/:id/move', async (req, res) => {
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

router.get('/groups/:id/urls', async (req, res) => {
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

router.post('/groups/:id/batch-screenshot', async (req, res) => {
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

router.post('/groups/batch-operation', async (req, res) => {
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

export default router;
