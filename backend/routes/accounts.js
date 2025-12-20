const express = require("express");
const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

const router = express.Router();

// GET /api/accounts
router.get("/", ensureAuth, async (req, res) => {
  const rows = await Account.find({ owner: req.user._id }).sort({ code: 1 });
  res.json({ ok: true, data: rows });
});

// POST /api/accounts
router.post("/", ensureAuth, async (req, res) => {
  const { code, name, type, parentCode } = req.body;
  const doc = await Account.create({
    owner: req.user._id,
    code,
    name,
    type,
    parentCode: parentCode || null,
    isDefault: false,
  });
  res.status(201).json({ ok: true, data: doc });
});

// PUT /api/accounts/:id
router.put("/:id", ensureAuth, async (req, res) => {
  const updated = await Account.findOneAndUpdate(
    { _id: req.params.id, owner: req.user._id },
    { $set: req.body },
    { new: true }
  );
  if (!updated) return res.status(404).json({ message: "No encontrado." });
  res.json({ ok: true, data: updated });
});

// DELETE /api/accounts/:id
router.delete("/:id", ensureAuth, async (req, res) => {
  const deleted = await Account.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
  if (!deleted) return res.status(404).json({ message: "No encontrado." });
  res.json({ ok: true });
});

module.exports = router;
