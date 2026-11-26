/**
 * PLAN-008 — shared by setup-database*.js (after the migrations): every company's
 * Owner role holds every active permission. Setup creates no Owner (companies and
 * their Owners are onboarded in the back office, utils/companies.js); it only tops
 * up existing Owner roles with permissions added since (as `write`), so a new
 * permission reaches every Owner on the next `npm run db:setup`.
 *
 * @param {import("mysql2/promise").Connection} connection - database already selected
 * @param {string} timestamp - Manila "YYYY-MM-DD HH:mm:ss"
 * @returns {Promise<number>} grants added
 */
export async function topUpOwnerRoles(connection, timestamp) {
  const [granted] = await connection.query(
    `INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
     SELECT r.roleId, p.permissionId, 'write', ?
     FROM roles r
     CROSS JOIN permissions p
     WHERE r.roleName = 'Owner' AND r.status = 'Active' AND p.status = 'Active'
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp
         WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
       )`,
    [timestamp]
  );
  if (granted.affectedRows > 0) {
    console.log(`   ✅ ${granted.affectedRows} permission(s) granted to companies' Owner roles`);
  }
  return granted.affectedRows;
}
