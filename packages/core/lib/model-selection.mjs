export function selectDiscoveredModel(selection, runtime, snapshot, proposal) {
  if (!snapshot) {
    if (proposal) throw new Error('[cc-nexs] model selection requires a host snapshot');
    return { ...selection, source: 'configured-or-inherited' };
  }
  if (snapshot.runtime !== runtime || !Array.isArray(snapshot.models)) {
    throw new Error('[cc-nexs] model catalog does not match the role executor');
  }
  const pinned = selection.model !== 'inherit';
  const model = pinned ? selection.model : proposal?.model || 'inherit';
  if (!pinned && proposal && (typeof proposal.reason !== 'string' || !proposal.reason.trim())) {
    throw new Error('[cc-nexs] dynamic model selection requires a reason');
  }
  if (model === 'inherit') return { ...selection, source: 'host-inherit' };
  const entry = snapshot.models.find((item) => item.id === model);
  if (!entry) throw new Error(`[cc-nexs] model is not available to ${runtime}: ${model}`);
  const effort = !pinned && proposal?.effort ? proposal.effort : selection.effort;
  if (effort !== 'inherit' && entry.efforts && !entry.efforts.includes(effort)) {
    throw new Error(`[cc-nexs] ${model} does not support effort ${effort}`);
  }
  return { ...selection, model, effort, source: pinned ? 'explicit-config' : 'host-discovery', reason: pinned ? null : proposal.reason };
}
