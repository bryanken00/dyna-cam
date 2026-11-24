/**
 * Rows from either kind of handle a shared helper may be given:
 *   - `req.db` (the Database class): `query()` returns the rows directly;
 *   - a transaction connection (`conn`): `execute()` returns `[rows, fields]`.
 * Lets one helper run inside or outside a transaction without mixing the two
 * return shapes (see db-patterns.md).
 *
 * Don't bind LIMIT/OFFSET through this — prepared statements reject them.
 */
export const selectRows = async (db, sql, params = []) => {
  if (typeof db.execute === "function") {
    const [rows] = await db.execute(sql, params);
    return rows;
  }
  return db.query(sql, params);
};
