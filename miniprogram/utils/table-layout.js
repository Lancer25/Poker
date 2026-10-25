(function (root) {
  function seatLayout(players, me) {
    const count = players.length;
    const ownIndex = players.findIndex((player) => player.id === me);
    const first = ownIndex < 0 ? 0 : ownIndex;
    const crowded = {
      7: [[50, 84], [14, 68], [14, 36], [36, 14], [64, 14], [86, 36], [86, 68]],
      8: [[50, 84], [14, 76], [14, 50], [14, 24], [50, 14], [86, 24], [86, 50], [86, 76]],
      9: [[50, 84], [14, 74], [14, 52], [14, 30], [36, 12], [64, 12], [86, 30], [86, 52], [86, 74]],
    }[count];
    return players.map((_, offset) => {
      const angle = (2 * Math.PI * offset) / count;
      return {
        index: (first + offset) % count,
        x: crowded ? crowded[offset][0] : Math.max(14, Math.min(86, 50 - 40 * Math.sin(angle))),
        y: crowded ? crowded[offset][1] : 50 + 34 * Math.cos(angle),
      };
    });
  }
  // One layout implementation for the browser and WeChat's CommonJS runtime.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { seatLayout };
  } else {
    root.TableLayout = { seatLayout };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
