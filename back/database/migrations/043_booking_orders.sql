-- 043_booking_orders.sql
-- CR-047 / PLAN-007: a player books several courts (or several runs of hours) for
-- one day and pays once. The bookings made together belong to one order; one
-- Xendit invoice ("order-<orderCode>") pays all of them, with one payment row
-- per booking (its own price), so each can still be cancelled — and refunded —
-- on its own. Single bookings and staff bookings have no order.
--
-- booking_orders   one per checkout of several bookings (orderCode = the invoice reference)
-- bookings.orderId the order a booking was made in (NULL: made alone); never changes
-- payments         an order's invoice pays several bookings: providerRef is unique per
--                  booking instead of on its own

CREATE TABLE IF NOT EXISTS booking_orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  orderId VARCHAR(50) NOT NULL UNIQUE,
  orderCode VARCHAR(12) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  playerId VARCHAR(50) NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_booking_orders_venue (venueId),
  CONSTRAINT fk_booking_orders_venue FOREIGN KEY (venueId) REFERENCES venues(venueId),
  CONSTRAINT fk_booking_orders_player FOREIGN KEY (playerId) REFERENCES players(playerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bookings
  ADD COLUMN orderId VARCHAR(50) NULL AFTER playerId,
  ADD INDEX idx_bookings_orderId (orderId),
  ADD CONSTRAINT fk_bookings_order FOREIGN KEY (orderId) REFERENCES booking_orders(orderId);

ALTER TABLE payments
  ADD UNIQUE INDEX uq_payments_providerRef_booking (providerRef, bookingId);

ALTER TABLE payments
  DROP INDEX uq_payments_providerRef;
