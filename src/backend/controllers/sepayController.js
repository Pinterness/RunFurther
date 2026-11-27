const express = require('express');
const mongoose = require('mongoose');
const { readSepayConnections } = require('../config/sepay');
const { verifySignature, parsePayload } = require('../services/sepayPayload');
const { receiveTransaction, processReceipt } = require('../services/sepayService');
const Receipt = require('../models/SepayReceipt');
const { assert } = require('../lib/errors');

const webhookRouter = express.Router();
webhookRouter.post('/:connectionId', express.raw({ type: 'application/json', limit: '32kb' }), async (req, res, next) => {
  try {
    const connection = readSepayConnections().find(item => item.id === req.params.connectionId && item.enabled);
    assert(connection, 404, 'SePay connection is not enabled.');
    assert(req.is('application/json'), 415, 'Use application/json.');
    verifySignature(req.body, req.headers, connection.secret);
    let payload;
    try { payload = JSON.parse(req.body.toString('utf8')); } catch { assert(false, 400, 'Invalid JSON.'); }
    // SePay dashboard probes use id 0. A signed probe verifies connectivity only, never credits money.
    if (payload?.id === 0) return res.json({ success: true, result: 'TEST_ONLY' });
    const data = parsePayload(payload, connection);
    assert(mongoose.connection.readyState === 1, 503, 'Database temporarily unavailable. Please retry.');
    const receipt = await receiveTransaction(data);
    res.set('Cache-Control', 'no-store').json({ success: true, result: receipt.status });
  } catch (error) { next(error); }
});

function scope(req) {
  return req.params.eventId ? { kind: 'BOOKING', eventId: req.params.eventId } : { kind: 'TOPUP', eventId: null };
}

async function listReceipts(req, res, next) {
  try {
    const filter = scope(req);
    if (req.query.status) {
      assert(['RECEIVED', 'APPLIED', 'REVIEW', 'IGNORED'].includes(req.query.status), 400, 'Invalid receipt status.');
      filter.status = req.query.status;
    }
    if (req.query.before) {
      assert(mongoose.isObjectIdOrHexString(req.query.before), 400, 'Invalid cursor.');
      filter._id = { $lt: req.query.before };
    }
    const receipts = await Receipt.find(filter).sort({ _id: -1 }).limit(51).lean();
    const more = receipts.length > 50;
    if (more) receipts.pop();
    res.set('Cache-Control', 'no-store').json({ receipts, nextCursor: more ? String(receipts.at(-1)._id) : null });
  } catch (error) { next(error); }
}

async function retryReceipt(req, res, next) {
  try {
    const receipt = await Receipt.findOne({ _id: req.params.receiptId, ...scope(req) });
    assert(receipt, 404, 'Receipt not found.');
    const connection = readSepayConnections().find(item => item.id === receipt.connectionId && item.enabled &&
      item.kind === receipt.kind && item.eventId === (receipt.eventId ? String(receipt.eventId) : null) &&
      item.bankBin === receipt.bankBin && item.accountNumber === receipt.accountNumber && item.subAccount === receipt.subAccount);
    assert(connection, 409, 'Original SePay connection is not enabled.');
    await Receipt.updateOne({ _id: receipt._id, status: 'REVIEW' }, { $set: { status: 'RECEIVED' } });
    const result = await processReceipt(receipt._id);
    res.json({ receipt: result });
  } catch (error) { next(error); }
}

module.exports = { webhookRouter, listReceipts, retryReceipt };
