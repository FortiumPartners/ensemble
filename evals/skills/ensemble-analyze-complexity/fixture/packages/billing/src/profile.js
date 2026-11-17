const session = require("../../auth/src/session");
module.exports = { me: (u) => session.start(u) };
