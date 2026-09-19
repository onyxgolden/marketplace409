/**
 * categorize.js
 *
 * FORGE Brain slice 2: auto-categorization suggestions.
 *
 * Deterministic, local, no LLM calls. trainCategorizer() learns from historical
 * decided categorizations (description + amount -> category); suggestCategory()
 * ranks categories for a new item with a confidence in [0,1] and human-readable
 * reasons. Suggestions are advisory only -- the human gate (checkbox + CONFIRM)
 * is what applies anything.
 *
 * Scoring is a multinomial naive-Bayes-style log-linear model, dependency-free
 * and explainable:
 *   score(cat) = log P(cat)
 *     + sum over description tokens of log P(token | cat)      (Laplace-smoothed)
 *     + FIRST_TOKEN_WEIGHT * log P(leading token | cat)        (merchant-ish head)
 *     + log P(amount band | cat)                                (half-decade buckets)
 *     + log P(sign | cat)                                       (inflow vs outflow)
 *     + EXACT_DESCRIPTION_BOOST                                 (seen this exact text)
 *
 * Confidence:
 *   - an exact description match seen in training -> 0.97 (near-certain)
 *   - otherwise sigmoid(margin / T) * min(1, evidence / L), where `evidence`
 *     is how much better the features explain the item than a background
 *     (uniform) model, and `margin` is the top-two score gap. Weak or
 *     ambiguous evidence lands < 0.5.
 *   - a sign veto fires when a category's training is strongly one-signed
 *     (>=80%, >=4 samples) and the item's sign contradicts it: a large
 *     negative boost plus an explicit warning reason.
 *
 * Never throws on weird input: bad models yield [], bad items are coerced.
 */

const STOPWORDS = new Set(
  [
    // English glue
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or",
    "the", "to", "with",
    // Bank-feed noise tokens that carry no merchant signal
    "ach", "pos", "ppd", "ccd", "web", "tel", "arc", "debit", "credit", "card",
    "purchase", "payment", "paid", "ref", "reference", "no", "num", "number",
    "transaction", "transfer", "xfer", "electronic", "online", "recurring",
  ].map((word) => word),
);

const FIRST_TOKEN_WEIGHT = 3; // merchant-ish leading tokens count extra
const EXACT_DESCRIPTION_BOOST = 6; // nats; dominates the token terms
const SIGN_VETO_BOOST = -6; // nats; a contradicted one-sided pattern is a hard no
const SIGN_VETO_MIN_COUNT = 4; // veto only with enough history to mean it
const SIGN_VETO_MIN_SHARE = 0.8; // veto only when the pattern is strongly one-sided
const CONFIDENCE_TEMPERATURE = 2; // margin scale for the sigmoid
const CONFIDENCE_LIFT_SCALE = 6; // evidence scale before the cap
const EXACT_MATCH_CONFIDENCE = 0.97;
const MAX_SUGGESTIONS = 3;
const LAPLACE_ALPHA = 1;

/**
 * normalizeDescriptionTokens(description) -> { tokens, key }
 * Lowercase, strip punctuation/numbers, drop stopwords. `key` is the joined
 * token string used for exact-description matching.
 */
export function normalizeDescriptionTokens(description) {
  const text = String(description ?? "").toLowerCase();
  const tokens = text
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOPWORDS.has(token));
  return { tokens, key: tokens.join(" ") };
}

/**
 * amountBand(amount) -> integer | null
 * Half-decade buckets: band b covers [10^(b/2), 10^((b+1)/2)). So a $1,482.50
 * mortgage (band 6) never matches a $14.82 coffee (band 2). Non-positive or
 * non-numeric amounts have no band (null).
 */
export function amountBand(amount) {
  const magnitude = Math.abs(Number(amount));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  return Math.floor(Math.log10(magnitude) * 2);
}

function compactDollars(value) {
  if (value >= 1000) {
    const thousands = value / 1000;
    const rounded = thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10;
    return `$${rounded}k`;
  }
  return `$${Math.round(value)}`;
}

/** amountBandLabel(band) -> e.g. "$1k-$3.2k" */
export function amountBandLabel(band) {
  const low = 10 ** (band / 2);
  const high = 10 ** ((band + 1) / 2);
  return `${compactDollars(low)}-${compactDollars(high)}`;
}

function isDecidedCategory(category) {
  // 'other' is the system's "undecided" marker (see isAmbiguousRowResolved);
  // null/undefined/empty carry no signal either.
  return typeof category === "string" && category !== "" && category !== "other";
}

/**
 * trainCategorizer(items) -> model
 * items: [{ description, amount, category }]. Rows with undecided categories
 * are ignored. Returns a plain JSON-serializable model.
 */
export function trainCategorizer(items) {
  const categories = Object.create(null);
  let totalCount = 0;
  const vocabulary = new Set();
  const bandsSeen = new Set();

  const list = Array.isArray(items) ? items : [];
  for (const raw of list) {
    if (raw == null || typeof raw !== "object") continue;
    const { category } = raw;
    if (!isDecidedCategory(category)) continue;

    const { tokens, key } = normalizeDescriptionTokens(raw.description);
    const band = amountBand(raw.amount);
    const amountNumber = Number(raw.amount);
    const sign = amountNumber < 0 ? "out" : amountNumber > 0 ? "in" : "flat";

    let stats = categories[category];
    if (!stats) {
      stats = {
        count: 0,
        tokenCounts: Object.create(null),
        firstTokenCounts: Object.create(null),
        tokenItemHits: Object.create(null), // raw: # of training items containing the token
        bandCounts: Object.create(null),
        signCounts: { in: 0, out: 0, flat: 0 },
        exactCounts: Object.create(null),
        totalTokens: 0,
      };
      categories[category] = stats;
    }

    stats.count += 1;
    totalCount += 1;
    if (band !== null) {
      stats.bandCounts[band] = (stats.bandCounts[band] ?? 0) + 1;
      bandsSeen.add(band);
    }
    stats.signCounts[sign] += 1;
    if (key) {
      stats.exactCounts[key] = (stats.exactCounts[key] ?? 0) + 1;
    }

    const seenInItem = new Set();
    tokens.forEach((token, index) => {
      vocabulary.add(token);
      stats.tokenCounts[token] = (stats.tokenCounts[token] ?? 0) + 1;
      stats.totalTokens += 1;
      if (index === 0) {
        stats.firstTokenCounts[token] = (stats.firstTokenCounts[token] ?? 0) + 1;
      }
      if (!seenInItem.has(token)) {
        seenInItem.add(token);
        stats.tokenItemHits[token] = (stats.tokenItemHits[token] ?? 0) + 1;
      }
    });
  }

  return {
    categories,
    totalCount,
    vocabularySize: vocabulary.size,
    bandCount: bandsSeen.size,
  };
}

function isUsableModel(model) {
  return (
    model != null &&
    typeof model === "object" &&
    Number.isFinite(model.totalCount) &&
    model.totalCount > 0 &&
    model.categories != null &&
    typeof model.categories === "object"
  );
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function prettyCategory(category) {
  return String(category)
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * suggestCategory(model, item) -> [{ category, confidence, reasons }]
 * item: { description, amount }. Ranked best-first, at most MAX_SUGGESTIONS.
 * confidence in [0,1]; reasons are the top-2 contributing human-readable signals.
 */
export function suggestCategory(model, item) {
  if (!isUsableModel(model)) return [];

  const safeItem = item != null && typeof item === "object" ? item : {};
  const { tokens, key } = normalizeDescriptionTokens(safeItem.description);
  const band = amountBand(safeItem.amount);
  const amountNumber = Number(safeItem.amount);
  const sign = amountNumber < 0 ? "out" : amountNumber > 0 ? "in" : "flat";

  const vocabSize = Math.max(model.vocabularySize, 1);
  const distinctBands = Math.max(model.bandCount, 1);

  const scored = [];
  for (const [category, stats] of Object.entries(model.categories)) {
    const count = stats.count;
    const logPrior = Math.log(count / model.totalCount);

    // Description tokens (Laplace-smoothed multinomial).
    let tokenScore = 0;
    const tokenDenominator = stats.totalTokens + LAPLACE_ALPHA * vocabSize;
    for (const token of tokens) {
      tokenScore += Math.log(((stats.tokenCounts[token] ?? 0) + LAPLACE_ALPHA) / tokenDenominator);
    }

    // Leading token gets its own distribution, weighted up (merchant signal).
    let firstTokenScore = 0;
    if (tokens.length > 0) {
      const head = tokens[0];
      firstTokenScore =
        FIRST_TOKEN_WEIGHT *
        Math.log(((stats.firstTokenCounts[head] ?? 0) + LAPLACE_ALPHA) / (count + LAPLACE_ALPHA * vocabSize));
    }

    // Amount band.
    let bandScore = 0;
    let bandHits = 0;
    if (band !== null) {
      bandHits = stats.bandCounts[band] ?? 0;
      bandScore = Math.log((bandHits + LAPLACE_ALPHA) / (count + LAPLACE_ALPHA * distinctBands));
    }

    // Sign (inflow vs outflow).
    let signScore = 0;
    let signVeto = false;
    if (sign !== "flat") {
      signScore = Math.log(((stats.signCounts[sign] ?? 0) + LAPLACE_ALPHA) / (count + LAPLACE_ALPHA * 2));
      // A strongly one-sided category contradicted by the item's sign gets a
      // hard veto: an outflow at an inflow-only merchant is not that category.
      const inCount = stats.signCounts.in ?? 0;
      const outCount = stats.signCounts.out ?? 0;
      const signedTotal = inCount + outCount;
      if (count >= SIGN_VETO_MIN_COUNT && signedTotal > 0) {
        const dominant = inCount >= outCount ? "in" : "out";
        if (dominant !== sign && Math.max(inCount, outCount) / signedTotal >= SIGN_VETO_MIN_SHARE) {
          signVeto = true;
        }
      }
    }
    const signVetoScore = signVeto ? SIGN_VETO_BOOST : 0;

    // Exact description match -- the strongest single signal.
    const exactHits = key ? (stats.exactCounts[key] ?? 0) : 0;
    const exactScore = exactHits > 0 ? EXACT_DESCRIPTION_BOOST + Math.log(1 + exactHits) : 0;

    const featureLift = tokenScore + firstTokenScore + bandScore + signScore + signVetoScore + exactScore;

    // Evidence: how much better the features explain this item than a
    // background model (uniform token/band/sign). Raw log-probs are always
    // negative, so the absolute sum is meaningless -- the lift is what counts.
    let backgroundLift = 0;
    if (tokens.length > 0) {
      backgroundLift += tokens.length * Math.log(1 / vocabSize);
      backgroundLift += FIRST_TOKEN_WEIGHT * Math.log(1 / vocabSize);
    }
    if (band !== null) backgroundLift += Math.log(1 / distinctBands);
    if (sign !== "flat") backgroundLift += Math.log(1 / 2);
    const evidence = featureLift - backgroundLift;

    const score = logPrior + featureLift;

    // Best token signal for the reasons (raw item-hit count, most readable).
    let bestToken = null;
    for (const token of tokens) {
      const hits = stats.tokenItemHits[token] ?? 0;
      if (hits > 0 && (!bestToken || hits > bestToken.hits)) {
        bestToken = { token, hits };
      }
    }

    scored.push({ category, score, logPrior, evidence, exactHits, bestToken, bandHits, sign, band, signVeto });
  }

  if (scored.length === 0) return [];
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUpScore = scored.length > 1 ? scored[1].score : top.logPrior;
  const margin = top.score - runnerUpScore;

  let confidence;
  if (top.exactHits > 0) {
    confidence = EXACT_MATCH_CONFIDENCE;
  } else {
    confidence = sigmoid(margin / CONFIDENCE_TEMPERATURE) * Math.min(1, top.evidence / CONFIDENCE_LIFT_SCALE);
    confidence = Math.min(0.99, Math.max(0, confidence));
  }

  const reasons = [];
  if (top.signVeto) {
    const label = top.sign === "out" ? "outflow" : "inflow";
    reasons.push(`warning: ${label} contradicts past ${prettyCategory(top.category)} pattern`);
  }
  if (top.exactHits > 0) {
    reasons.push(`exact description seen ${top.exactHits}x`);
  }
  if (top.bestToken) {
    reasons.push(`matched "${top.bestToken.token}" in ${top.bestToken.hits} past ${prettyCategory(top.category)} transaction(s)`);
  }
  if (top.band !== null && top.bandHits > 0 && reasons.length < 2) {
    reasons.push(`amount near ${amountBandLabel(top.band)}`);
  }
  if (top.sign !== "flat" && reasons.length < 2) {
    const signStats = model.categories[top.category].signCounts;
    const signTotal = signStats.in + signStats.out;
    const label = top.sign === "out" ? "outflow" : "inflow";
    reasons.push(`${label} matches ${prettyCategory(top.category)} pattern (${signTotal > 0 ? `${signStats[top.sign]} of ${signTotal}` : "no"} past ${label}s)`);
  }

  const ranked = [
    {
      category: top.category,
      confidence: Math.round(confidence * 1000) / 1000,
      reasons: reasons.slice(0, 2),
    },
  ];

  // Include runners-up with their own (lower) confidence for transparency.
  for (const entry of scored.slice(1, MAX_SUGGESTIONS)) {
    const runnerMargin = entry.score - top.score; // <= 0 by sort order
    const runnerConfidence =
      entry.exactHits > 0
        ? EXACT_MATCH_CONFIDENCE
        : Math.min(0.99, Math.max(0, sigmoid(runnerMargin / CONFIDENCE_TEMPERATURE) * Math.min(1, entry.evidence / CONFIDENCE_LIFT_SCALE)));
    ranked.push({
      category: entry.category,
      confidence: Math.round(runnerConfidence * 1000) / 1000,
      reasons: [],
    });
  }

  return ranked;
}

/**
 * suggestTopCategory(model, item) -> { category, confidence, reasons } | null
 * Convenience for call sites that only need the best suggestion.
 */
export function suggestTopCategory(model, item) {
  const ranked = suggestCategory(model, item);
  return ranked.length > 0 ? ranked[0] : null;
}
