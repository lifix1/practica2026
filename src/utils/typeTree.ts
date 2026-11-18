import type { EquipmentType } from '../types/index.ts';

export const MAX_TYPE_DEPTH = 10;

export interface FlattenedTypeOption {
  type: EquipmentType;
  depth: number;
  label: string;
  pathLabel: string;
}

export interface TypeTreeIndex {
  byId: Map<number, EquipmentType>;
  roots: EquipmentType[];
  childrenByParent: Map<number, EquipmentType[]>;
  depthById: Map<number, number>;
  subtreeHeightById: Map<number, number>;
  ancestorIdsById: Map<number, number[]>;
  descendantIdsById: Map<number, Set<number>>;
}

function sortByNameRu(a: EquipmentType, b: EquipmentType): number {
  return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
}

export function buildTypeTreeIndex(types: EquipmentType[]): TypeTreeIndex {
  const safeTypes = Array.isArray(types) ? types : [];
  const byId = new Map<number, EquipmentType>();
  for (const t of safeTypes) {
    byId.set(Number(t.id), t);
  }

  const childrenByParent = new Map<number, EquipmentType[]>();
  const roots: EquipmentType[] = [];

  for (const t of safeTypes) {
    const pid = t.parent_id !== null && t.parent_id !== undefined ? Number(t.parent_id) : null;
    if (pid !== null && pid !== Number(t.id) && byId.has(pid)) {
      const list = childrenByParent.get(pid) || [];
      list.push(t);
      childrenByParent.set(pid, list);
    } else {
      roots.push(t);
    }
  }

  roots.sort(sortByNameRu);
  for (const list of childrenByParent.values()) {
    list.sort(sortByNameRu);
  }

  const depthById = new Map<number, number>();
  const ancestorIdsById = new Map<number, number[]>();

  // Assign depths top-down via BFS so cycles/orphans are handled safely
  const queue: Array<{ node: EquipmentType; depth: number; ancestors: number[] }> = roots.map(
    (node) => ({ node, depth: 1, ancestors: [] })
  );

  while (queue.length > 0) {
    const { node, depth, ancestors } = queue.shift()!;
    const id = Number(node.id);
    if (depthById.has(id)) continue;

    depthById.set(id, depth);
    ancestorIdsById.set(id, ancestors);

    const children = childrenByParent.get(id) || [];
    for (const child of children) {
      if (!depthById.has(Number(child.id))) {
        queue.push({
          node: child,
          depth: depth + 1,
          ancestors: [...ancestors, id],
        });
      }
    }
  }

  // Fallback for any disconnected cycle in malformed data
  for (const t of safeTypes) {
    const id = Number(t.id);
    if (!depthById.has(id)) {
      depthById.set(id, 1);
      ancestorIdsById.set(id, []);
      if (!roots.some((r) => Number(r.id) === id)) {
        roots.push(t);
      }
    }
  }

  const subtreeHeightById = new Map<number, number>();
  const descendantIdsById = new Map<number, Set<number>>();

  const computeSubtree = (id: number, visiting = new Set<number>()): { height: number; descendants: Set<number> } => {
    if (subtreeHeightById.has(id) && descendantIdsById.has(id)) {
      return {
        height: subtreeHeightById.get(id)!,
        descendants: descendantIdsById.get(id)!,
      };
    }
    if (visiting.has(id)) {
      return { height: 1, descendants: new Set() };
    }
    visiting.add(id);

    let maxChildHeight = 0;
    const descendants = new Set<number>();
    const children = childrenByParent.get(id) || [];
    for (const child of children) {
      const cid = Number(child.id);
      descendants.add(cid);
      const childRes = computeSubtree(cid, visiting);
      if (childRes.height > maxChildHeight) {
        maxChildHeight = childRes.height;
      }
      for (const d of childRes.descendants) {
        descendants.add(d);
      }
    }

    visiting.delete(id);
    const height = 1 + maxChildHeight;
    subtreeHeightById.set(id, height);
    descendantIdsById.set(id, descendants);
    return { height, descendants };
  };

  for (const t of safeTypes) {
    computeSubtree(Number(t.id));
  }

  return {
    byId,
    roots,
    childrenByParent,
    depthById,
    subtreeHeightById,
    ancestorIdsById,
    descendantIdsById,
  };
}

export function flattenTypeTree(types: EquipmentType[]): FlattenedTypeOption[] {
  const index = buildTypeTreeIndex(types);
  const result: FlattenedTypeOption[] = [];
  const visited = new Set<number>();

  const walk = (node: EquipmentType, depth: number, pathNames: string[]) => {
    const id = Number(node.id);
    if (visited.has(id) || depth > MAX_TYPE_DEPTH + 2) return;
    visited.add(id);

    const nextPath = [...pathNames, node.name];
    const indent = depth > 1 ? `${'\u00A0\u00A0'.repeat(depth - 1)}↳ ` : '';
    result.push({
      type: node,
      depth,
      label: `${indent}${node.name}`,
      pathLabel: nextPath.join(' › '),
    });

    const children = index.childrenByParent.get(id) || [];
    for (const child of children) {
      walk(child, depth + 1, nextPath);
    }
  };

  for (const root of index.roots) {
    walk(root, 1, []);
  }

  return result;
}
