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

module.exports = { saveTransaction, listTransactions };
