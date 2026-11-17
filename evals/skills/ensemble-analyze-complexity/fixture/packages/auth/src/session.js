const { sign } = require("./tokens");
module.exports = { start: (u) => sign(u) };
