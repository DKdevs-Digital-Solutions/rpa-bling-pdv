const router = require("express").Router();
const { getToken } = require("../controllers/token.controller");

router.get("/", getToken);

module.exports = router;
