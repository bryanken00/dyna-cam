-- 003_add_button_code_to_courts.sql
-- PLAN-001 Phase 2: a physical button per court. The button (a Shelly or
-- ESP32 Wi-Fi button) calls the venue's recorder box on the LAN with its code;
-- the box relays the press to the API, which saves a clip for that court.
-- Codes are unique across all courts so a press can never land on the wrong one.

ALTER TABLE courts ADD COLUMN buttonCode VARCHAR(32) NULL AFTER qrToken;
CREATE UNIQUE INDEX uq_courts_buttonCode ON courts (buttonCode);
