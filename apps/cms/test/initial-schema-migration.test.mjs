import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { down, parseBaselineContract, up } from '../src/migrations/20261123_060000_initial_schema.ts'

const baseline = await readFile(new URL('../src/migrations/20261123_060000_initial_schema.sql', import.meta.url), 'utf8')
const contract = parseBaselineContract(baseline)

function mockDatabase(results) {
  let calls = 0
  return {
    db: {
      execute: async () => ({ rows: results[calls++] ?? [] }),
    },
    get calls() { return calls },
  }
}

function completeSchemaRows() {
  return [
    [...contract.tables.keys()].map((name) => ({ name })),
    [...contract.enums].map((name) => ({ name })),
    [...contract.sequences].map((name) => ({ name })),
    [...contract.tables].flatMap(([table_name, columns]) => [...columns].map((column_name) => ({ table_name, column_name }))),
    [...contract.indexes].map((name) => ({ name })),
    [...contract.constraints].map((name) => ({ name })),
  ]
}

test('fresh database receives the ledger-free baseline SQL resource', async () => {
  const mock = mockDatabase([[], [], [], [], [], [], []])
  await up({ db: mock.db })
  assert.equal(mock.calls, 4, 'three inspection queries and the baseline DDL execution')
})

test('complete schema is recognized structurally without executing baseline DDL', async () => {
  const mock = mockDatabase(completeSchemaRows())
  await up({ db: mock.db })
  assert.equal(mock.calls, 6, 'only the schema inspection queries should run')
})

test('same-named partial schema missing a column is refused', async () => {
  const rows = completeSchemaRows()
  rows[3] = rows[3].filter((row) => !(row.table_name === 'pages' && row.column_name === 'slug'))
  const mock = mockDatabase(rows)
  await assert.rejects(up({ db: mock.db }), /columns:.*pages\.slug/)
  assert.equal(mock.calls, 6, 'no baseline DDL should run after detecting a partial schema')
})

test('partial schema with missing indexes or constraints is refused', async () => {
  const rows = completeSchemaRows()
  rows[4] = rows[4].slice(1)
  const mock = mockDatabase(rows)
  await assert.rejects(up({ db: mock.db }), /indexes:/)
  assert.equal(mock.calls, 6, 'no baseline DDL should run after detecting a partial schema')
})

test('baseline rollback is explicitly refused without issuing destructive SQL', async () => {
  const mock = mockDatabase([])
  await assert.rejects(down({ db: mock.db }), /intentionally irreversible/)
  assert.equal(mock.calls, 0)
})
