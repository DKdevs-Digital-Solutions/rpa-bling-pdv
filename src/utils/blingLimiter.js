const sleep = require("./sleep");

// 5 segundos entre chamadas
const DELAY = 5000;

let lastCall = 0;

async function waitTurn() {
  const now = Date.now();
  const diff = now - lastCall;

  if (diff < DELAY) {
    await sleep(DELAY - diff);
  }

  lastCall = Date.now();
}

module.exports = { waitTurn };
