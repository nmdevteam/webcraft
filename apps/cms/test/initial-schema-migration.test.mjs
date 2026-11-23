import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { down, parseBaselineContract, up } from '../src/migrations/20261123_060000_initial_schema.ts'

const baseline = await readFile(new URL('../src/migrations/20261123_060000_initial_schema.sql', import.meta.url), 'utf8')
const contract = parseBaselineContract(baseline)

function mockDatabase(results) {
  const queries = []
  return {
    db: {
      execute: async (query) => {
        queries.push(query)
        return { rows: results[queries.length - 1] ?? [] }
      },
    },
    get calls() { return queries.length },
    queries,
  }
}

function queryText(query) {
  return query.queryChunks.flatMap((chunk) => Array.isArray(chunk?.value) ? chunk.value : []).join('')
}

function completeSchemaRows({ ledgerExists = true } = {}) {
  return [
    [...contract.tables.keys()].map((name) => ({ name })),
    [...contract.enums].map((name) => ({ name })),
    [...contract.sequences].map((name) => ({ name })),
    [{ exists: ledgerExists }],
    [...contract.tables].flatMap(([table_name, columns]) => [...columns].map((column_name) => ({ table_name, column_name }))),
    [...contract.indexes].map((name) => ({ name })),
    [...contract.constraints].map((name) => ({ name })),
  ]
}

test('fresh database bootstraps Payload ledger and installs the ledger-free application baseline', async () => {
  const mock = mockDatabase([[], [], [], [{ exists: false }]])
  await up({ db: mock.db })
  assert.equal(mock.calls, 6, 'three application-schema queries, ledger check, ledger bootstrap, and baseline DDL')
  assert.match(queryText(mock.queries[4]), /CREATE TABLE public\.payload_migrations/)
  assert.match(queryText(mock.queries[5]), /CREATE TABLE public\.asset_folders/)
  assert.doesNotMatch(queryText(mock.queries[5]), /CREATE TABLE public\.payload_migrations/)
})

test('complete schema with an existing ledger is recognized structurally without executing DDL', async () => {
  const mock = mockDatabase(completeSchemaRows())
  await up({ db: mock.db })
  assert.equal(mock.calls, 7, 'only schema inspection queries should run')
})

test('complete schema without a migration ledger bootstraps only the ledger', async () => {
  const mock = mockDatabase(completeSchemaRows({ ledgerExists: false }))
  await up({ db: mock.db })
  assert.equal(mock.calls, 8, 'schema inspections plus one ledger bootstrap')
  assert.match(queryText(mock.queries[7]), /CREATE TABLE public\.payload_migrations/)
  assert.doesNotMatch(queryText(mock.queries[7]), /CREATE TABLE public\.asset_folders/)
})

test('same-named partial schema missing a column is refused without DDL', async () => {
  const rows = completeSchemaRows()
  rows[4] = rows[4].filter((row) => !(row.table_name === 'pages' && row.column_name === 'slug'))
  const mock = mockDatabase(rows)
  await assert.rejects(up({ db: mock.db }), /columns:.*pages\.slug/)
  assert.equal(mock.calls, 7, 'no baseline or ledger DDL should run after detecting a partial schema')
})

test('partial schema with missing indexes or constraints is refused without DDL', async () => {
  const rows = completeSchemaRows()
  rows[5] = rows[5].slice(1)
  const mock = mockDatabase(rows)
  await assert.rejects(up({ db: mock.db }), /indexes:/)
  assert.equal(mock.calls, 7, 'no baseline or ledger DDL should run after detecting a partial schema')
})

test('baseline rollback is explicitly refused without issuing destructive SQL', async () => {
  const mock = mockDatabase([])
  await assert.rejects(down({ db: mock.db }), /intentionally irreversible/)
  assert.equal(mock.calls, 0)
})
