/**
 * middleware/catalogueAccess.js
 *
 * Who may print the catalogue (spec): Sales, IT, Manager, Director — and
 * foreign (country-scoped) MANAGERS. A country-scoped admin of any other
 * sub-role (e.g. a foreign Sales Agent) is NOT allowed. Capability itself is
 * the `catalogue.download` permission (requirePermission); this adds the
 * foreign-role restriction. Must run after countryScope.
 */
export function catalogueAccess(req, res, next) {
  const sub = req.user?.subRole;
  const allowed = ["SALES", "SALES_MANAGER", "MANAGER", "IT", "DIRECTOR"];
  if (!allowed.includes(sub)) {
    return res.status(403).json({ message: "Catalogue access denied for your role", error: true, success: false });
  }
  if (req.countryScope && sub !== "MANAGER") {
    return res.status(403).json({
      message: "Only the country Manager can print the catalogue for a foreign country",
      error: true,
      success: false,
    });
  }
  next();
}
export default catalogueAccess;
