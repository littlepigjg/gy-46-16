export function buildTree(groups, parentId = null) {
  const children = groups
    .filter(g => g.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order);
  return children.map(g => ({
    ...g,
    children: buildTree(groups, g.id)
  }));
}

export function getDescendantIds(db, groupId, ids = []) {
  ids.push(groupId);
  const children = db.prepare('SELECT id FROM groups WHERE parent_id = ?').all(groupId);
  for (const c of children) {
    getDescendantIds(db, c.id, ids);
  }
  return ids;
}

export const VALID_FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'];
export const validFrequencies = VALID_FREQUENCIES;
