---
type: fixed
impact: patch
audience: user
---

The plain-text version of emails (password resets, the Google Drive link) no longer shows stray
codes such as `&#39;` in place of apostrophes. The Payments list no longer skips or repeats a
payment between pages when several were taken in the same second.

## Dev notes

- back/: `lib/mailer/mailer.js` decodes HTML entities in the plain-text part it builds;
  `GET /admin/payments` orders by `paidAt DESC, id DESC`.
