/**
 * PLAN-009: player-app fixtures for demo mode (`IS_DEMO`, constants/index.js).
 * Every consumer is behind an `IS_DEMO` check in services/requests/.
 *
 * Shapes mirror GET /player/me, GET /player/games and GET /public/venues.
 * Sign in skips Google and signs in "Demo Player", whose profile still needs
 * completing, so that screen can be seen.
 */

/** Not real tokens — demo mode sends them nowhere. */
export const DEMO_PLAYER_TOKENS = {
  accessToken: { token: "demo-player-access-not-real", expiresAt: null },
  refreshToken: { token: "demo-player-refresh-not-real", expiresAt: null },
};

let demoPlayer = {
  firstName: "Demo",
  middleName: "",
  lastName: "Player",
  name: "Demo Player",
  email: "player@example.com",
  photoUrl: null,
  phone: null,
  profileComplete: false,
};

export const demoGetPlayer = () => ({ player: { ...demoPlayer } });

export const demoSaveProfile = ({ firstName, middleName, lastName, phone }) => {
  demoPlayer = {
    ...demoPlayer,
    firstName,
    middleName: middleName || "",
    lastName,
    phone: phone || null,
    name: [firstName, middleName, lastName].filter(Boolean).join(" "),
    profileComplete: true,
  };
  return demoGetPlayer();
};

export const demoVenues = () => ({
  venues: [
    {
      name: "Smash Point BGC",
      address: "5th Ave, Fort Bonifacio, Taguig City, Metro Manila",
      phone: "0912 3456 789",
      logoUrl: null,
      directionsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.5509%2C121.0503",
      bookingToken: "demo-booking-bgc",
      bookingUrl: null,
      courtCount: 6,
      latitude: 14.5509,
      longitude: 121.0503,
      todayHours: { opensAt: "06:00", closesAt: "25:00" },
    },
    {
      name: "Dink House Quezon City",
      address: "Tomas Morato Ave, Quezon City, Metro Manila",
      phone: null,
      logoUrl: null,
      directionsUrl: "https://www.google.com/maps/dir/?api=1&destination=14.6345%2C121.0353",
      bookingToken: "demo-booking-qc",
      bookingUrl: null,
      courtCount: 4,
      latitude: 14.6345,
      longitude: 121.0353,
      todayHours: null,
    },
  ],
  signInAvailable: true,
});

export const demoMyGames = () => ({
  upcoming: [
    {
      bookingCode: "BK-7QM2",
      venueName: "Smash Point BGC",
      courtName: "Court 2",
      startAt: "2026-11-28 18:00:00",
      endAt: "2026-11-28 20:00:00",
      status: "Confirmed",
      paymentStatus: "Paid",
      price: 900,
      bookingUrl: null,
      games: [],
    },
  ],
  past: [
    {
      bookingCode: "BK-3HX9",
      venueName: "Smash Point BGC",
      courtName: "Court 1",
      startAt: "2026-11-20 07:00:00",
      endAt: "2026-11-20 08:00:00",
      status: "Completed",
      paymentStatus: "Paid",
      price: 450,
      bookingUrl: null,
      games: [
        {
          startAt: "2026-11-20 07:02:00",
          endAt: "2026-11-20 07:58:00",
          status: "Ready",
          gameUrl: null,
          driveUrl: "https://drive.google.com/",
        },
      ],
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, pages: 1 },
});
