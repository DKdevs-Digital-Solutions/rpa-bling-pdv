const router = require("express").Router();
const { start, callback } = require("../controllers/auth.controller");

router.get("/start", start);
router.get("/callback", callback);

module.exports = router;
