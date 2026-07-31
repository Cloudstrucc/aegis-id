// Tamper-evident evidence ledger — pure hash-chain primitives (no I/O).
//
// Each record links to the previous one by hash:
//   payloadHash = sha256(canonicalize(core))
//   hash        = sha256(seq . prevHash . payloadHash)
// Editing or deleting any record breaks every subsequent hash, which
// verifyChain() detects and pinpoints. Signing/anchoring live in adapters.

const crypto = require('node:crypto');

// prevHash for the genesis record: base64 of 32 zero bytes.
const GENESIS_PREV_HASH = Buffer.alloc(32).toString('base64');

// Deterministic JSON: object keys sorted recursively so the hash is stable
// regardless of key insertion order.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sha256b64(input) {
  return crypto.createHash('sha256').update(input).digest('base64');
}

// The immutable "core" of an event — the only fields protected by payloadHash.
// Chain metadata (seq/prevHash/hash) and operational metadata (sig/anchor/
// migrated) are intentionally excluded so they can be added without self-reference.
function coreOf(record) {
  return {
    id: record.id,
    type: record.type,
    data: record.data,
    createdAt: record.createdAt
  };
}

function payloadHashOf(core) {
  return sha256b64(canonicalize(core));
}

function recordHashOf(seq, prevHash, payloadHash) {
  return sha256b64(`${seq}.${prevHash}.${payloadHash}`);
}

// Build the chained fields for `core` given the previous chained record (or null).
function buildChainedRecord(prev, core) {
  const seq = prev ? prev.seq + 1 : 0;
  const prevHash = prev ? prev.hash : GENESIS_PREV_HASH;
  const payloadHash = payloadHashOf(core);
  const hash = recordHashOf(seq, prevHash, payloadHash);
  return { seq, ...core, payloadHash, prevHash, hash };
}

// Re-chain an ordered array of (possibly-unchained) records from genesis.
// Extra fields on each record are preserved; chain fields are (re)computed.
function chainAll(records) {
  const out = [];
  let prev = null;
  for (const record of records) {
    const chained = buildChainedRecord(prev, coreOf(record));
    out.push({ ...record, ...chained });
    prev = chained;
  }
  return out;
}

// A store is "chained" when every record has a contiguous seq and a hash.
function isChained(records) {
  return records.every((record, index) => typeof record.seq === 'number' && record.seq === index && typeof record.hash === 'string');
}

function fail(index, record, reason) {
  return { ok: false, brokenAtSeq: typeof record?.seq === 'number' ? record.seq : index, reason, count: index };
}

// Verify the full chain. Pass { verifySignature: (record) => boolean } to also
// check signatures on records that carry a `sig`.
function verifyChain(records, options = {}) {
  const verifySignature = options.verifySignature;
  let prevHash = GENESIS_PREV_HASH;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record.seq !== index) {
      return fail(index, record, 'seq-out-of-order');
    }
    if (record.prevHash !== prevHash) {
      return fail(index, record, 'prev-hash-mismatch');
    }
    const payloadHash = payloadHashOf(coreOf(record));
    if (record.payloadHash !== payloadHash) {
      return fail(index, record, 'payload-tampered');
    }
    const hash = recordHashOf(record.seq, record.prevHash, payloadHash);
    if (record.hash !== hash) {
      return fail(index, record, 'hash-mismatch');
    }
    if (verifySignature && record.sig && !verifySignature(record)) {
      return fail(index, record, 'signature-invalid');
    }

    prevHash = record.hash;
  }

  return { ok: true, count: records.length };
}

module.exports = {
  GENESIS_PREV_HASH,
  canonicalize,
  payloadHashOf,
  recordHashOf,
  coreOf,
  buildChainedRecord,
  chainAll,
  isChained,
  verifyChain
};
