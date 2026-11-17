const taken = new Map();

function reserve(building, resident) {
  for (let slot = 1; slot <= 40; slot += 1) {
    const key = `${building}:${slot}`;
    if (!taken.has(key)) {
      taken.set(key, resident);
      return slot;
    }
  }
  return null;
}

module.exports = { reserve };
