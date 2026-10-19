/**
 * Additive "is this account Belgian?" evidence scorer, ported from the
 * bluesky-belgians list-grower (belgians/signals.py). Weights stack so a list
 * can be sorted by confidence rather than gambled on a yes/no threshold:
 * 🇧🇪 + Brussels + KU Leuven = 3 + 2 + 2 = 7, a lone `.be` handle = 3.
 * Empirically, score ≥ 3 was ~90% precise and ≥ 5 effectively 100%.
 */
export type BelgianSignals = { score: number; signals: string[] }

// JS `\b` is ASCII-only (even with /u), so accented endings like "belgië"
// would never match; use Unicode-aware letter/number lookarounds instead.
const word = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu')

const RULES: { name: string; weight: number; pattern: RegExp }[] = [
  { name: '🇧🇪', weight: 3, pattern: /🇧🇪/u },
  { name: 'country', weight: 3, pattern: word('belgium|belgique|belgië|belgie|belgien') },
  {
    name: 'institution',
    weight: 2,
    pattern: word('ulb|vub|uclouvain|ku ?leuven|ugent|uliège|uliege|ulg|vrt|rtbf|imec|kbr'),
  },
  { name: 'nationality', weight: 1, pattern: word('belgian|belge|belg|belgisch|belgische') },
  {
    name: 'football',
    weight: 1,
    pattern: word('anderlecht|club brugge|standard (?:de )?liège|rsca|kaa gent|krc genk|union saint-gilloise|rusg'),
  },
]

// Multilingual city/region variants. `namen` (NL "names") and `bergen`
// (NL "mountains", Norway) are deliberately excluded as false-positive sources.
const PLACES: Record<string, RegExp> = {
  Brussels: word('brussel|brussels|bruxelles|bxl'),
  Antwerp: word('antwerpen|antwerp|anvers'),
  Ghent: word('ghent|gent|gand'),
  Liège: word('liège|liege|luik'),
  Charleroi: word('charleroi'),
  Bruges: word('brugge|bruges'),
  Leuven: word('leuven|louvain(?:-la-neuve)?'),
  Namur: word('namur'),
  Mons: word('mons'),
  Hasselt: word('hasselt'),
  Mechelen: word('mechelen|malines'),
  Kortrijk: word('kortrijk|courtrai'),
  Ostend: word('oostende|ostend'),
  Tournai: word('tournai|doornik'),
  Wallonia: word('wallonia|wallonie|wallonië'),
  Flanders: word('flanders|vlaanderen|flandre'),
}

export function belgianSignals(acc: {
  handle?: string | null
  displayName?: string | null
  description?: string | null
}): BelgianSignals {
  const handle = acc.handle ?? ''
  const text = [handle, acc.displayName ?? '', acc.description ?? ''].join('\n')
  const signals: string[] = []
  let score = 0

  if (/\.be$/i.test(handle)) {
    signals.push('.be handle')
    score += 3
  }
  for (const r of RULES) {
    if (r.pattern.test(text)) {
      signals.push(r.name)
      score += r.weight
    }
  }
  const places = Object.entries(PLACES).filter(([, re]) => re.test(text)).map(([name]) => name)
  if (places.length) {
    signals.push(...places)
    score += 2
  }
  return { score, signals }
}
