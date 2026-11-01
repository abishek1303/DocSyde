import "server-only";
import { createHash } from "node:crypto";

export const SCHEMA_FINGERPRINT_VERSION = 2 as const;
type Expression = { kind: string; value?: string; args: Expression[] };
const node = (kind: string, args: Expression[] = [], value?: string): Expression => ({ kind, ...(value === undefined ? {} : { value }), args });
export class UnsupportedSchemaExpression extends Error {
  constructor(expression: string) { super(`Unsupported schema expression: ${expression}`); }
}
/** Bounded PostgreSQL expression grammar for the predicates/defaults in our migrations.
 * Parentheses are parsed, not deleted; operator precedence and NULL tests survive.
 */
export function canonicalExpression(source: string, table: string): Expression {
  const tokens: string[] = [];
  const lexer = /\s+|'(?:''|[^'])*'|"(?:""|[^"])*"|::|->>|->|>=|<=|<>|!=|[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+|[()[\],.=~<>+-]/gy;
  let offset = 0;
  while (offset < source.length) {
    lexer.lastIndex = offset; const match = lexer.exec(source);
    if (!match) throw new UnsupportedSchemaExpression(source);
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
    offset = lexer.lastIndex;
  }
  let position = 0;
  const peek = () => tokens[position]?.toLowerCase();
  const take = () => tokens[position++];
  const expect = (value: string) => { if (peek() !== value) throw new UnsupportedSchemaExpression(source); take(); };
  const name = (value: string) => value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase();
  function expression(minimum = 0): Expression {
    let left: Expression;
    const token = take(); if (!token) throw new UnsupportedSchemaExpression(source);
    if (token === '(') { left = expression(); expect(')'); }
    else if (token.startsWith("'")) left = node('literal', [], token.slice(1, -1).replaceAll("''", "'"));
    else if (/^[0-9]+$/.test(token)) left = node('number', [], token);
    else if (/^[a-zA-Z_"]/.test(token)) {
      const parts = [name(token)];
      while (peek() === '.') { take(); const part = take(); if (!part) throw new UnsupportedSchemaExpression(source); parts.push(name(part)); }
      if (parts[0] === 'array' && peek() === '[') {
        take(); const values: Expression[] = [];
        if (peek() !== ']') { do { values.push(expression()); if (peek() !== ',') break; take(); } while (true); }
        expect(']'); left = node('array', values);
      } else if (peek() === '(') {
        take(); const fn = parts.join('.').replace(/^pg_catalog\./, '');
        if (fn === 'trim') { expect('both'); expect('from'); const argument = expression(); expect(')'); left = node('call', [argument], 'btrim'); }
        else {
        if (!['length', 'btrim', 'lower', 'jsonb_typeof', 'octet_length', 'jsonb_array_length', 'any', 'now', 'gen_random_uuid'].includes(fn)) throw new UnsupportedSchemaExpression(source);
        const args: Expression[] = [];
        if (peek() !== ')') { do { args.push(expression()); if (peek() !== ',') break; take(); } while (true); }
        expect(')'); left = node('call', args, fn);
        }
      } else {
        if (parts.length > 1 && parts.slice(0, -1).join('.') !== table && parts.slice(0, -1).join('.') !== table.split('.').at(-1)) throw new UnsupportedSchemaExpression(source);
        left = node('column', [], parts.at(-1));
      }
    } else throw new UnsupportedSchemaExpression(source);
    while (position < tokens.length) {
      const operator = peek();
      if (operator === '::') {
        if (90 < minimum) break;
        take(); let type = name(take() ?? '');
        if (type === 'pg_catalog' && peek() === '.') { take(); type = name(take() ?? ''); }
        if (type === 'character' && peek() === 'varying') { take(); type = 'varchar'; }
        if (!['text', 'varchar', 'jsonb', 'uuid', 'integer', 'bigint', 'boolean'].includes(type)) throw new UnsupportedSchemaExpression(source);
        if (peek() === '[') { take(); expect(']'); type += '[]'; }
        left = node('cast', [left], type); continue;
      }
      const precedence = operator === 'or' ? 10 : operator === 'and' ? 20 : operator === 'is' ? 30
        : ['=', '~', '>', '<', '>=', '<=', '<>', '!='].includes(operator ?? '') ? 40 : ['->', '->>'].includes(operator ?? '') ? 60 : -1;
      if (precedence < minimum) break;
      take();
      if (operator === 'is') {
        const negated = peek() === 'not'; if (negated) take();
        const test = take()?.toLowerCase(); if (!['null', 'true', 'false'].includes(test ?? '')) throw new UnsupportedSchemaExpression(source);
        left = node('test', [left], `is${negated ? ' not' : ''} ${test}`);
      } else left = node('binary', [left, expression(precedence + 1)], operator);
    }
    return left;
  }
  const parsed = expression();
  if (position !== tokens.length) throw new UnsupportedSchemaExpression(source);
  function normalize(value: Expression): Expression {
    const result = { ...value, args: value.args.map(normalize) };
    // The sole cast-distribution equivalence: unbounded varchar string literals
    // coerced to text, either per element or through the complete literal array.
    // No column casts, typmods, JSONB casts or arbitrary expression casts disappear.
    if (result.kind === 'cast' && result.value === 'text[]' && result.args[0].kind === 'array') {
      const elements = result.args[0].args;
      if (elements.every(item => item.kind === 'cast' && item.value === 'varchar' && item.args[0].kind === 'literal')) {
        return node('array', elements.map(item => node('cast', [item.args[0]], 'text')));
      }
    }
    if (result.kind === 'cast' && result.value === 'text' && result.args[0].kind === 'cast'
      && result.args[0].value === 'varchar' && result.args[0].args[0].kind === 'literal') return node('cast', [result.args[0].args[0]], 'text');
    return result;
  }
  return normalize(parsed);
}

export type SchemaFacts = {
  tables: Record<string, unknown>[]; columns: Record<string, unknown>[];
  constraints: (Record<string, unknown> & { table: string; expression: string | null })[];
  indexes: (Record<string, unknown> & { table: string; predicate: string | null })[];
  migrations: Record<string, unknown>[];
};
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]));
  return value;
}
export function semanticSchema(facts: SchemaFacts) {
  const sort = (rows: unknown[]) => rows.map(ordered).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  return { version: SCHEMA_FINGERPRINT_VERSION, tables: sort(facts.tables), migrations: sort(facts.migrations),
    columns: sort(facts.columns.map(column => ({ ...column, default: column.default === null ? null : canonicalExpression(String(column.default), String(column.table)) }))),
    constraints: sort(facts.constraints.map(constraint => ({ ...constraint, expression: constraint.expression === null ? null : canonicalExpression(constraint.expression, constraint.table) }))),
    indexes: sort(facts.indexes.map(index => ({ ...index, predicate: index.predicate === null ? null : canonicalExpression(index.predicate, index.table) }))) };
}
export function schemaFingerprint(facts: SchemaFacts) {
  return { version: SCHEMA_FINGERPRINT_VERSION, sha256: createHash('sha256').update(JSON.stringify(ordered(semanticSchema(facts)))).digest('hex') };
}
