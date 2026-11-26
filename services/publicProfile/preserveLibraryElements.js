export const LIBRARY_ELEMENT_TYPE = 'ui-element';

function blockType(block) {
  return block?.type || block?.data?.type || '';
}

function cloneBlock(block) {
  return JSON.parse(JSON.stringify(block));
}

export function preserveLibraryElements(source = [], migrated = []) {
  const original = Array.isArray(source) ? source : [];
  const library = original.filter((block) => blockType(block) === LIBRARY_ELEMENT_TYPE);
  if (!library.length) return Array.isArray(migrated) ? migrated : [];

  const base = (Array.isArray(migrated) ? migrated : []).filter(
    (block) => blockType(block) !== LIBRARY_ELEMENT_TYPE,
  );
  const byId = new Map(base.filter((block) => block?.id).map((block) => [block.id, block]));
  const structural = original.filter((block) => blockType(block) !== LIBRARY_ELEMENT_TYPE);
  const idsMatch = structural.length > 0
    && structural.every((block) => block?.id && byId.has(block.id));

  if (!idsMatch) {
    const next = [...base];
    const footerIndex = next.findIndex((block) => blockType(block) === 'footer');
    next.splice(footerIndex >= 0 ? footerIndex : next.length, 0, ...library.map(cloneBlock));
    return next;
  }

  const used = new Set();
  const result = [];
  original.forEach((block) => {
    if (blockType(block) === LIBRARY_ELEMENT_TYPE) {
      result.push(cloneBlock(block));
      return;
    }
    const next = byId.get(block.id);
    if (!next || used.has(next.id)) return;
    result.push(next);
    used.add(next.id);
  });

  base.forEach((block) => {
    if (!block?.id || used.has(block.id)) return;
    const footerIndex = result.findIndex((item) => blockType(item) === 'footer');
    result.splice(footerIndex >= 0 ? footerIndex : result.length, 0, block);
    used.add(block.id);
  });

  return result;
}
