/**
 * A fixed, small, predictable cost at session start. Predictable cost is the
 * feature — a board whose context load grows with backlog size gets uninstalled.
 */
export const DEFAULT_BUDGET_TOKENS = 1000;

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface Block {
  name: string;
  /** Lower drops first. Notes and the active task outrank the backlog index. */
  priority: number;
  lines: string[];
}

export interface BudgetResult {
  lines: string[];
  tokens: number;
  dropped: Array<{ name: string; lines: number }>;
  overBudget: boolean;
}

/**
 * Degrades, never fails. A session-start command that errors leaves the agent
 * with no context at all, which is worse than slightly too much.
 */
export function fit(blocks: Block[], budget = DEFAULT_BUDGET_TOKENS): BudgetResult {
  const keep: Array<Block & { trimmed?: boolean }> = blocks.map((b) => ({ ...b }));
  const dropped: Array<{ name: string; lines: number }> = [];

  const render = (bs: Block[]) => bs.flatMap((b) => b.lines).join("\n");

  while (estimateTokens(render(keep)) > budget && keep.length > 0) {
    let worstIdx = -1;
    let worst = Number.POSITIVE_INFINITY;
    for (let i = 0; i < keep.length; i++) {
      const p = keep[i]!.priority;
      if (p < worst) {
        worst = p;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) break;
    const victim = keep[worstIdx]!;
    // Every iteration must either shrink a block or remove one, or the loop
    // never terminates and the one command that must never fail hangs instead.
    // Re-trimming an already-trimmed block cannot shrink it, so it goes.
    if (!victim.trimmed && victim.lines.length > 5) {
      const removed = victim.lines.length - 4;
      keep[worstIdx] = {
        ...victim,
        trimmed: true,
        lines: [...victim.lines.slice(0, 4), `  … ${removed} more`],
      };
      dropped.push({ name: victim.name, lines: removed });
      continue;
    }
    keep.splice(worstIdx, 1);
    dropped.push({ name: victim.name, lines: victim.lines.length });
  }

  const text = render(keep);
  return {
    lines: text.split("\n"),
    tokens: estimateTokens(text),
    dropped: mergeDrops(dropped),
    overBudget: dropped.length > 0,
  };
}

function mergeDrops(drops: Array<{ name: string; lines: number }>) {
  const byName = new Map<string, number>();
  for (const d of drops) byName.set(d.name, (byName.get(d.name) ?? 0) + d.lines);
  return [...byName].map(([name, lines]) => ({ name, lines }));
}
