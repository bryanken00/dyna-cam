-- 048_venue_location.sql
-- CR-050: a venue's address from the Philippine address list (PSGC: region → province →
-- city / municipality → barangay, plus an optional street) and its map pin. `address`
-- stays: it's the built text every page shows ("Street, Barangay, City, Province"), and
-- venues saved before keep their typed one until edited. All NULL = not set.
--   *Code       PSGC codes from front/src/assets/address (regCode, provCode, citymunCode, brgyCode)
--   latitude /  the pin (WGS84, 6 decimals ≈ 0.1 m); both or neither. Players get a Google Maps
--   longitude   "Get directions" link from them.

ALTER TABLE venues
  ADD COLUMN regionCode VARCHAR(10) NULL AFTER address,
  ADD COLUMN provinceCode VARCHAR(10) NULL AFTER regionCode,
  ADD COLUMN cityMunCode VARCHAR(12) NULL AFTER provinceCode,
  ADD COLUMN barangayCode VARCHAR(12) NULL AFTER cityMunCode,
  ADD COLUMN street VARCHAR(255) NULL AFTER barangayCode,
  ADD COLUMN latitude DECIMAL(9,6) NULL AFTER street,
  ADD COLUMN longitude DECIMAL(9,6) NULL AFTER latitude;
