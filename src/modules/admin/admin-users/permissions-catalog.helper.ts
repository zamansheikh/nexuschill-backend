import { PERMISSIONS } from '../permissions.catalog';

/**
 * Groups the permission catalog by resource for easier rendering in the
 * admin panel's role-editing UI.
 */
export function permissionCategories(): Array<{
  resource: string;
  label: string;
  permissions: Array<{ value: string; label: string; description?: string }>;
}> {
  const all = Object.values(PERMISSIONS) as string[];

  const groups = new Map<
    string,
    { resource: string; label: string; permissions: Array<{ value: string; label: string }> }
  >();

  for (const perm of all) {
    if (perm === '*') {
      continue; // wildcard exposed separately
    }
    const [resource, ...actionParts] = perm.split('.');
    const label = humanize(resource);
    if (!groups.has(resource)) {
      groups.set(resource, { resource, label, permissions: [] });
    }
    groups.get(resource)!.permissions.push({
      value: perm,
      label: humanize(actionParts.join('.')),
    });
  }

  return Array.from(groups.values()).sort((a, b) => a.resource.localeCompare(b.resource));
}

function humanize(key: string): string {
  return key
    .replace(/[_.]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
