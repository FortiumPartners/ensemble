const session = require("../../auth/src/session");
module.exports = { invoice: (u) => session.start(u) };
