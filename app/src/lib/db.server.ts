import pg from 'pg'

// Return date/timestamp columns as strings instead of JS Date objects
pg.types.setTypeParser(1082, (val: string) => val) // date
pg.types.setTypeParser(1114, (val: string) => val) // timestamp
pg.types.setTypeParser(1184, (val: string) => val) // timestamptz

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query(sql, params)
  return rows as T[]
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}
