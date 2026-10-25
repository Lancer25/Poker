// Only loaded in spawned test servers; production continues to use crypto.randomInt.
const crypto = require("node:crypto");
let roomId = 0;
let state = 0x8a3bc19d;
crypto.randomInt = (...args) => {
  if (args.length === 2) return args[0] + roomId++;
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state % args[0];
};
require("node:module").syncBuiltinESMExports();
