# Coin Master

A small household-budget web app for two phones: one person updates it, the other views it.

- Runs entirely in the browser (installable on iPhone via *Add to Home Screen*).
- The budget data lives in `data/budget.enc.json`, encrypted on the phone before publishing
  (AES-GCM-256, key derived from a passphrase with PBKDF2-SHA256, 600,000 rounds).
  Without the passphrase the file is unreadable.
- Publishing uses a fine-grained GitHub token that exists only on the updating phone.
- No server, no analytics, no third-party scripts.
