const router = require("express").Router();
const { sync, status } = require("../controllers/sync.controller");

router.post("/", sync);
router.get("/status", status);

module.exports = router;
