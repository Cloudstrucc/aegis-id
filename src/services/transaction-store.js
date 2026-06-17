const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.transactions, []);

async function saveTransaction(record) {
  return store.append({
    ...record,
    createdAt: record.createdAt || new Date().toISOString()
  });
}

async function listTransactions() {
  return store.read();
}

async function getTransaction(transactionId) {
  const records = await store.read();
  return records.find((record) => record.id === transactionId) || null;
}

async function updateTransactionByState(state, patch) {
  if (!state) {
    return null;
  }

  const records = await store.read();
  const index = records.findIndex((record) => record.state === state);
  if (index === -1) {
    return null;
  }

  records[index] = {
    ...records[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await store.write(records);
  return records[index];
}

module.exports = { getTransaction, listTransactions, saveTransaction, updateTransactionByState };
