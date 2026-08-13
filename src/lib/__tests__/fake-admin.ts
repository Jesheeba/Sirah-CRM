/**
 * Minimal in-memory stand-in for the service-role Supabase client, just enough to drive
 * the real query chains meta-data-deletion.ts uses (select/eq/in/order/limit/maybeSingle,
 * update, delete, insert). Not a Postgrest reimplementation — only what's exercised here.
 * There's no test-Supabase-instance in this project, so this is what makes the deletion
 * pipeline testable without one.
 */

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: Row[] | Row | null; error: null; count?: number }> {
  private op: "select" | "update" | "delete" | "insert" | "upsert" = "select";
  private filtered: Row[];
  private values: Row | undefined;
  private upsertConflict: string[] | undefined;
  private single = false;
  private head = false;
  private wantCount = false;

  constructor(private rows: Row[]) {
    this.filtered = rows;
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    this.op = "select";
    this.head = Boolean(opts?.head);
    this.wantCount = Boolean(opts?.count);
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  insert(values: Row) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  /** Matches an existing row by the onConflict columns; updates it in place, else inserts. */
  upsert(values: Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.values = values;
    this.upsertConflict = (opts?.onConflict ?? "id").split(",");
    return this;
  }
  eq(col: string, val: unknown) {
    this.filtered = this.filtered.filter((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filtered = this.filtered.filter((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.filtered = this.filtered.slice(0, n);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<TResult1 = { data: Row[] | Row | null; error: null; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let result: { data: Row[] | Row | null; error: null; count?: number };

    if (this.op === "select") {
      if (this.head) {
        result = { data: null, error: null, count: this.filtered.length };
      } else if (this.single) {
        result = { data: this.filtered[0] ?? null, error: null };
      } else {
        result = { data: this.filtered, error: null, count: this.wantCount ? this.filtered.length : undefined };
      }
    } else if (this.op === "update") {
      this.filtered.forEach((r) => Object.assign(r, this.values));
      result = { data: this.filtered, error: null, count: this.filtered.length };
    } else if (this.op === "delete") {
      const ids = new Set(this.filtered.map((r) => r.id));
      for (let i = this.rows.length - 1; i >= 0; i--) {
        if (ids.has(this.rows[i].id)) this.rows.splice(i, 1);
      }
      result = { data: this.filtered, error: null, count: this.filtered.length };
    } else if (this.op === "upsert") {
      const cols = this.upsertConflict!;
      const values = this.values as Row;
      const existing = this.rows.find((r) => cols.every((c) => r[c] === values[c]));
      if (existing) {
        Object.assign(existing, values);
        result = { data: [existing], error: null };
      } else {
        const row = { id: `gen-${this.rows.length + 1}-${Math.round(Math.random() * 1e6)}`, ...values };
        this.rows.push(row);
        result = { data: [row], error: null };
      }
    } else {
      const row = { id: `gen-${this.rows.length + 1}-${Math.round(Math.random() * 1e6)}`, ...this.values };
      this.rows.push(row);
      result = { data: [row], error: null };
    }

    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

export class FakeAdmin {
  constructor(private tables: Record<string, Row[]>) {}
  from(name: string) {
    if (!this.tables[name]) this.tables[name] = [];
    return new FakeQuery(this.tables[name]);
  }
}
