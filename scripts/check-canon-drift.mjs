#!/usr/bin/env node
/**
 * Checks the node against the published ApiPay API contract.
 *
 * The node is the only program ApiPay.kz ships through npm, and the contract lives elsewhere.
 * Version 0.1.0 fell six months behind it and that was noticed by accident. This gate makes
 * the drift visible the same day.
 *
 * Contract source, in order of preference:
 *   1. $APIPAY_CANON — path to an openapi.yaml or openapi.json;
 *   2. ./.canon-path — a local, untracked file holding such a path;
 *   3. https://apipay.kz/openapi.json — the published spec.
 *
 * Deliberate omissions live in canon-skip.yaml, each with a reason. There is no such thing as
 * an empty reason: a line there means "looked at it and decided not to implement it".
 *
 * There used to be canon-todo.yaml as well — work still to come, explaining a difference by a
 * deadline rather than by a decision. That wave is closed and the file is gone; reading it is
 * still supported, because the next wave will not follow the contract in a single pass.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']

// ── contract ─────────────────────────────────────────────────────────────────

/**
 * A checkout of the API repository is not assumed and its location is not hard-coded here:
 * this repository is public. Point $APIPAY_CANON at the spec, or drop the path into
 * `.canon-path` (untracked). Without either, the published spec is used.
 */
function localCanonCandidates() {
  const pathFile = path.join(ROOT, '.canon-path')
  const fromFile = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : ''
  return [process.env.APIPAY_CANON, fromFile].filter(Boolean)
}

async function loadCanon() {
  for (const candidate of localCanonCandidates()) {
    if (fs.existsSync(candidate)) {
      const text = fs.readFileSync(candidate, 'utf8')
      const parsed = candidate.endsWith('.json') ? fromJson(JSON.parse(text)) : fromYaml(text)
      return { source: candidate, ...parsed }
    }
  }

  const url = 'https://apipay.kz/openapi.json'
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Contract unavailable: ${url} answered ${response.status}`)
  }
  return { source: url, ...fromJson(await response.json()) }
}

function fromJson(doc) {
  const operations = new Set()
  for (const [route, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (item?.[method]) operations.add(operationKey(method, route))
    }
  }
  return { operations, events: new Set(Object.keys(doc['x-webhooks'] ?? {})) }
}

/**
 * A line scanner instead of a YAML parser: all that is needed are the path keys, the methods
 * under them and the event names. A verified node may carry no runtime dependencies, and
 * pulling one in for this would not be worth it anyway.
 */
function fromYaml(text) {
  const operations = new Set()
  const events = new Set()
  let section = null
  let route = null

  for (const line of text.split('\n')) {
    if (/^[a-zA-Z"']/.test(line)) {
      section = line.startsWith('paths:') ? 'paths' : line.startsWith('x-webhooks:') ? 'webhooks' : null
      route = null
      continue
    }
    if (section === 'paths') {
      const routeMatch = line.match(/^ {2}["']?(\/[^"':]*)["']?:/)
      if (routeMatch) {
        route = routeMatch[1]
        continue
      }
      const methodMatch = line.match(/^ {4}([a-z]+):/)
      if (route && methodMatch && HTTP_METHODS.includes(methodMatch[1])) {
        operations.add(operationKey(methodMatch[1], route))
      }
      continue
    }
    if (section === 'webhooks') {
      const eventMatch = line.match(/^ {2}([a-z_]+\.[a-z_]+):/)
      if (eventMatch) events.add(eventMatch[1])
    }
  }

  return { operations, events }
}

/** `/invoices/{id}` and `/invoices/${invoiceId}` are the same operation. */
function operationKey(method, route) {
  return `${method.toUpperCase()} ${route.replace(/\{[^}]*\}/g, '{}')}`
}

// ── what the node covers ─────────────────────────────────────────────────────

function nodeCoverage() {
  const source = fs.readFileSync(path.join(ROOT, 'nodes/ApiPay/ApiPay.node.ts'), 'utf8')
  const operations = new Set()

  const calls = source.matchAll(/apiRequest\.call\(\s*this,\s*'([A-Z]+)',\s*([`'])([^`']+)\2/g)
  for (const [, method, , rawRoute] of calls) {
    operations.add(operationKey(method, rawRoute.replace(/\$\{[^}]*\}/g, '{}')))
  }

  // `paginate` wraps apiRequest with a variable endpoint, so the pattern above cannot see
  // through it. Its own call sites carry the path, and it is GET by construction.
  const paged = source.matchAll(/paginate\.call\(\s*this,\s*([`'])([^`']+)\1/g)
  for (const [, , rawRoute] of paged) {
    operations.add(operationKey('GET', rawRoute.replace(/\$\{[^}]*\}/g, '{}')))
  }

  // A wrapper that builds the URL itself (money routes need returnFullResponse, so they
  // cannot go through apiRequest). Pairs the template with the method next to it.
  // The path must start with a slash: inside the wrappers it arrives as a variable
  // (`${API_BASE_URL}${endpoint}`), and such a template carries no address — counting it as an
  // operation would invent `GET {}`.
  const direct = source.matchAll(
    /url: `\$\{API_BASE_URL\}(\/[^`]*)`,\s*\n\s*method: '([A-Z]+)'/g,
  )
  for (const [, rawRoute, method] of direct) {
    operations.add(operationKey(method, rawRoute.replace(/\$\{[^}]*\}/g, '{}')))
  }

  // ⛔ Tripwire. Coverage is read off the source, so a NEW request wrapper the patterns above
  // do not know about would silently look like missing coverage — that already happened twice
  // while this node was being filled in. Every direct call must live in a wrapper the gate
  // recognises; a new one has to be taught here, not discovered months later.
  // `loadOptionsRequest` only reads addresses already covered (/catalog/units, /catalog) to
  // fill the dropdowns, so it needs no coverage of its own — but it must still be counted.
  const KNOWN_WRAPPERS = ['apiRequest', 'executeQrRefund', 'loadOptionsRequest']
  const directCalls = (source.match(/httpRequestWithAuthentication\.call/g) ?? []).length
  if (directCalls !== KNOWN_WRAPPERS.length) {
    throw new Error(
      `ApiPay.node.ts makes ${directCalls} direct calls to httpRequestWithAuthentication, while ` +
        `this gate knows ${KNOWN_WRAPPERS.length} wrappers (${KNOWN_WRAPPERS.join(', ')}). A new wrapper ` +
        `has appeared — teach the gate to read it, or its operations drop out of coverage silently.`,
    )
  }

  const trigger = fs.readFileSync(path.join(ROOT, 'nodes/ApiPay/ApiPayTrigger.node.ts'), 'utf8')
  const events = new Set(
    [...trigger.matchAll(/value:\s*'([a-z_]+\.[a-z_]+)'/g)].map(([, event]) => event),
  )

  return { operations, events }
}

// ── deliberate omissions ─────────────────────────────────────────────────────

/** A flat map of `key: reason`. The key is either `METHOD /path` or an event name. */
function loadMap(name) {
  const file = path.join(ROOT, name)
  if (!fs.existsSync(file)) return new Map()

  const skips = new Map()
  for (const [index, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^["']?([^"']+?)["']?\s*:\s*(.+)$/)
    if (!match) {
      throw new Error(`${name}:${index + 1} — line is not in the form \`key: reason\``)
    }
    const [, key, reason] = match
    if (!reason.trim()) {
      throw new Error(`${name}:${index + 1} — entry without a reason`)
    }
    skips.set(key, reason.trim())
  }
  return skips
}

// ── report ───────────────────────────────────────────────────────────────────

function report(title, missing, skips, todo) {
  const unexplained = missing.filter((item) => !skips.has(item) && !todo.has(item))
  const skipped = missing.filter((item) => skips.has(item))
  const planned = missing.filter((item) => todo.has(item))

  console.log(
    `\n${title}: ${missing.length} not covered — ${skipped.length} deliberate, ${planned.length} planned, ${unexplained.length} unexplained`,
  )
  for (const item of unexplained.sort()) console.log(`  ✗ ${item}`)
  return unexplained
}

const canon = await loadCanon()
const node = nodeCoverage()
const skips = loadMap('canon-skip.yaml')
const todo = loadMap('canon-todo.yaml')

console.log(`Contract: ${canon.source}`)
console.log(`Operations in contract: ${canon.operations.size}, in node: ${node.operations.size}`)
console.log(`Events in contract: ${canon.events.size}, in node: ${node.events.size}`)

const missingOperations = [...canon.operations].filter((item) => !node.operations.has(item))
const missingEvents = [...canon.events].filter((item) => !node.events.has(item))

const unexplained = [
  ...report('Operations', missingOperations, skips, todo),
  ...report('Webhook events', missingEvents, skips, todo),
]

// The node calls something the contract does not list. Three causes: the contract moved, the
// node has a typo in a path, or the contract itself is incomplete — the last happens more often
// than one would think, and needs an entry just the same.
const unknown = [...node.operations]
  .filter((item) => !canon.operations.has(item))
  .filter((item) => !skips.has(item))
if (unknown.length) {
  console.log(`\nCalls the node makes that the contract does not list: ${unknown.length}`)
  for (const item of unknown.sort()) console.log(`  ⚠ ${item}`)
}

const nodeOnly = [...node.operations].filter((item) => !canon.operations.has(item))
const isStale = (key) =>
  !missingOperations.includes(key) && !missingEvents.includes(key) && !nodeOnly.includes(key)

const staleSkips = [...skips.keys()].filter(isStale)
if (staleSkips.length) {
  console.log(`\nOmissions that no longer omit anything: ${staleSkips.length}`)
  for (const item of staleSkips.sort()) console.log(`  ⚠ ${item}`)
}

// An entry in canon-todo that is already implemented is a reason to delete it: otherwise the
// file stops showing what is left and hides drift again.
const doneTodo = [...todo.keys()].filter(isStale)
if (doneTodo.length) {
  console.log(`\nAlready done but still listed in canon-todo.yaml: ${doneTodo.length}`)
  for (const item of doneTodo.sort()) console.log(`  ⚠ ${item}`)
}

if (unexplained.length || unknown.length) {
  console.log(
    `\n❌ The node differs from the contract with no explanation. Either implement it, or record why:` +
      `\n   canon-skip.yaml — decided against it; canon-todo.yaml — planned, with the wave it belongs to.`,
  )
  process.exit(1)
}

if (doneTodo.length) {
  console.log('\n❌ Remove from canon-todo.yaml what is already done.')
  process.exit(1)
}

const remaining = [...todo.keys()].length
console.log(
  remaining
    ? `\n✅ No new drift. ${remaining} still planned — see canon-todo.yaml.`
    : '\n✅ Node matches the contract.',
)
