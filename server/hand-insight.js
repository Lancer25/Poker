import solver from "pokersolver";
const { Hand } = solver;
const ranks = "23456789TJQKA";
const suits = "shdc";
const names = {
  "High Card": "高牌",
  Pair: "一对",
  "Two Pair": "两对",
  "Three of a Kind": "三条",
  Straight: "顺子",
  Flush: "同花",
  "Full House": "葫芦",
  "Four of a Kind": "四条",
  "Straight Flush": "同花顺",
};
const percent = (n) => Math.round(n * 1000) / 10;

// This boundary deliberately accepts no opponent hands or deck state.
export function handInsight({ cards, board, phase, folded = false }) {
  if (folded || ["waiting", "ended"].includes(phase) || cards.length !== 2)
    return null;
  const visible = [...cards, ...board];
  if (
    ![0, 3, 4, 5].includes(board.length) ||
    visible.some((c) => !/^[2-9TJQKA][shdc]$/.test(c)) ||
    new Set(visible).size !== visible.length
  )
    return null;
  if (!board.length) {
    const pair = cards[0][0] === cards[1][0];
    return {
      label: pair ? "手持对子" : "尚未成牌",
      detail: pair
        ? cards[0][0] + " 对"
        : cards.map((c) => c[0]).join(" / ") +
          (cards[0][1] === cards[1][1] ? " · 同花底牌" : " · 不同花底牌"),
      bestCards: [],
      draws: [],
      combined: null,
      note: "翻牌后由底牌和公共牌选出最佳五张；起手牌不代表最终胜率。",
    };
  }
  const solved = Hand.solve(visible);
  const bestCards = solved.cards.map(
    (c) => (c.value === "1" ? "A" : c.value) + c.suit,
  );
  const royal =
    solved.name === "Straight Flush" && solved.cards[0].value === "A";
  const label = royal ? "皇家同花顺" : names[solved.name];
  const groups = new Map();
  bestCards.forEach((c) => groups.set(c[0], (groups.get(c[0]) || 0) + 1));
  const repeated = [...groups]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || ranks.indexOf(b[0]) - ranks.indexOf(a[0]));
  const detail = repeated.length
    ? repeated.map(([rank, count]) => `${rank} × ${count}`).join(" · ")
    : `${bestCards[0][0]} 高${["Straight", "Straight Flush"].includes(solved.name) ? "顺子" : solved.name === "Flush" ? "同花" : "牌"}`;
  const boardOnly =
    board.length === 5 && Hand.solve(board).compare(solved) === 0;
  const draws = [];
  const allOuts = new Set();
  if (["flop", "turn"].includes(phase)) {
    const unknown = [...ranks]
      .flatMap((rank) => [...suits].map((suit) => rank + suit))
      .filter((c) => !visible.includes(c));
    const flushSuit = [...suits].find(
      (suit) => visible.filter((c) => c[1] === suit).length === 4,
    );
    if (flushSuit && solved.rank < 6)
      addDraw(
        "同花听牌",
        unknown.filter((c) => c[1] === flushSuit),
      );
    if (solved.rank < 5) {
      const values = new Set(visible.map((c) => ranks.indexOf(c[0]) + 2));
      if (values.has(14)) values.add(1);
      const missing = new Set();
      for (let low = 1; low <= 10; low++) {
        const gaps = Array.from({ length: 5 }, (_, i) => low + i).filter(
          (n) => !values.has(n),
        );
        if (gaps.length === 1) missing.add(gaps[0] === 1 ? 14 : gaps[0]);
      }
      if (missing.size)
        addDraw(
          "顺子听牌",
          unknown.filter((c) => missing.has(ranks.indexOf(c[0]) + 2)),
        );
    }
    function addDraw(label, outs) {
      outs.forEach((c) => allOuts.add(c));
      draws.push({
        label,
        outs: outs.length,
        nextProbability: percent(outs.length / unknown.length),
      });
    }
  }
  return {
    label,
    detail,
    bestCards,
    draws,
    combined:
      draws.length > 1
        ? {
            outs: allOuts.size,
            nextProbability: percent(allOuts.size / (52 - visible.length)),
          }
        : null,
    note: boardOnly
      ? "最佳组合与公共牌相同，不代表独占优势。"
      : phase === "river"
        ? "河牌已发完；当前牌型不代表一定领先。"
        : phase === "showdown"
          ? "结算以牌桌实际结果为准。"
          : "仅按可见牌计算下一张补成牌型的概率，不是获胜概率。",
  };
}

export function callPrice({
  pot,
  toCall,
  stack,
  actionable,
  covered,
  headsUp,
}) {
  if (!actionable || !headsUp || !covered || toCall <= 0 || stack < toCall)
    return null;
  return {
    percent: percent(toCall / (pot + toCall)),
    note: "仅按当前底池、无后续下注计算；不是你的实际胜率。",
  };
}
