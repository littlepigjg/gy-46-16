import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import getDb from '../../db.js';
import { validFrequencies } from '../utils/groupUtils.js';
import { triggerScreenshotNow } from '../../scheduler.js';

const router = Router();

router.get('/urls', async (req, res) => {
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

router.post('/urls', async (req, res) => {
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

router.delete('/urls/:id', async (req, res) => {
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

router.put('/urls/:id', async (req, res) => {
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

router.get('/urls/:id/screenshots', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshots = db.prepare(`
    SELECT * FROM screenshots
    WHERE url_id = ?
    ORDER BY created_at DESC
  `).all(id);
  res.json(screenshots);
});

router.get('/urls/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const url = db.prepare('SELECT * FROM urls WHERE id = ?').get(id);
  if (!url) {
    return res.status(404).json({ error: 'URL不存在' });
  }
  res.json(url);
});

router.post('/urls/:id/screenshot', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await triggerScreenshotNow(parseInt(id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/screenshots/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshot = db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id);
  if (!screenshot) {
    return res.status(404).json({ error: '截图不存在' });
  }
  res.json(screenshot);
});

router.delete('/screenshots/:id', async (req, res) => {
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

export default router;
