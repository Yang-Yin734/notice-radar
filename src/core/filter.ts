/** 关键词过滤：只做子串匹配（大小写不敏感），够用且可解释。正则等高级玩法留给后续版本。 */

export interface FilterOutcome {
  pass: boolean;
  reason: 'no-include' | 'excluded' | 'ok';
  hits: string[];
}

export function evaluate(title: string, include: string[], exclude: string[]): FilterOutcome {
  const hay = title.toLowerCase();

  const excluded = exclude.filter((k) => k && hay.includes(k.toLowerCase()));
  if (excluded.length > 0) return { pass: false, reason: 'excluded', hits: excluded };

  const includes = include.filter((k) => k && hay.includes(k.toLowerCase()));
  if (include.length > 0 && includes.length === 0) return { pass: false, reason: 'no-include', hits: [] };

  return { pass: true, reason: 'ok', hits: includes };
}
