import { Router } from 'express';
import getDb from '../../db.js';
import { getDescendantIds } from '../utils/groupUtils.js';

const router = Router();

router.get('/groups/stats/summary', async (req, res) => {
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
      total_storage_bytes: db.prepare('SELECT COALESCE(SUM(file_size_bytes), 0) as total FROM screenshots').get().total || 0
    };
    res.json({ groups: stats, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups/:id/stats/details', async (req, res) => {
  const { id } = req.params;
  const { period = '7d' } = req.query;
  try {
    const db = await getDb();
    const descendantIds = getDescendantIds(db, parseInt(id));
    const placeholders = descendantIds.map(() => '?').join(',');
    const days = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const screenshotsByDay = db.prepare(`
      SELECT DATE(s.created_at) as date, COUNT(*) as count, COALESCE(SUM(s.file_size_bytes), 0) as size
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

export default router;
