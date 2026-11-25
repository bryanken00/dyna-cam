# Recorder box security

How to lock down a venue's recorder box, and what to do when one is lost or stolen (CR-044). Do
this **after** the box is installed and recording:
[Mac](recorder-box-installation.md) · [Windows](recorder-box-installation-windows.md) · Linux
([edge/README.md](../edge/README.md#install-ubuntu-2404--debian-12)).

## Why it matters

A box holds the keys to its venue:

| On the box | Who could misuse it |
| --- | --- |
| Every court camera's login (in the camera addresses) | Watch the cameras, or lock them |
| The venue's live-stream keys, and players' own | Stream to those channels |
| Its own token (`data/device.json`) | Act as the box: see the venue's courts and games |
| Days of players' game videos (`data/videos/`) | Copy or share them |
| The enrol key (`.env`, until you remove it) | Add a fake box to any venue |

The box software already does its part:
- it talks to the cloud over HTTPS only, and checks the certificate;
- it keeps its files private to its own account;
- it masks passwords in its logs;
- its one network port (the live view) only plays links the cloud signed.

It warns in its log (`security: …`) when something below is missing. The rest is the machine
and the venue network, so follow this page.

## 1. Enrol keys: on only while installing

One enrol key lets a box join **any** venue whose ID you know, so keep enrolment off unless
you're installing a box.

1. **Before the install:** on the cloud server, set `RECORDER_ENROLL_KEY` in `back/.env`. Use a
   new one each time (`openssl rand -hex 32`). Then restart the API.
2. Install the box with that key as `ENROLL_KEY` in its `.env`. Wait for **Enrolled as …** in
   the log.
3. **After the install:**
   - Delete the `ENROLL_KEY=` value from the box's `.env`. It isn't needed again.
   - Clear `RECORDER_ENROLL_KEY` in `back/.env` on the server and restart the API. Enrolment is
     now off: a box that tries gets "enrolment is off", and boxes already enrolled keep working.
4. On the server, run `npm run boxes` in `back/` and check the list has only the boxes you
   expect.

## 2. Every box, any system

- [ ] **Its own account.** The box runs under a standard account, not root, not admin, and not
      someone's personal login. The `edge` folder lives where only that account can read it.
- [ ] **Never on the internet.** No port-forwarding to the box or the cameras. Support goes
      through a VPN (Tailscale/WireGuard) or happens on site.
- [ ] **Firewall:** the only way in is the live view (`8090`), from the venue network only.
- [ ] **HTTPS live view:** `CERT_PATH` set (Part F of the install guide). Without it the box
      warns at start.
- [ ] **`.env` holds no enrol key** after enrolment (section 1).
- [ ] **No stray copies:** no copies of `data/` or `.env` on USB sticks, shared folders or in
      chat. Delete leftovers such as `data-local-backup/`.
- [ ] **Updates:** the operating system installs security updates by itself. The box software is
      updated with each release (`git pull`, `npm ci --omit=dev`, `pm2 reload dyna-cam-edge`).
- [ ] **Physical:**
  - the box is in a locked cabinet or out of reach, wired to the router, on a small UPS;
  - set a BIOS/UEFI (firmware) password and allow booting from the internal disk only.
- [ ] **Log check:** after a restart, `pm2 logs dyna-cam-edge` shows no `security:` lines.

## 3. Linux (Ubuntu 24.04 / Debian 12)

Run these as an admin, then do the install as `dynacam`.

```bash
# Own account, no sudo. Install edge/ in its home folder.
sudo adduser --disabled-password --gecos "" dynacam
sudo -iu dynacam            # then clone, npm ci, .env, pm2 start — as in the install guide
# pm2 on boot as dynacam: run `pm2 startup` as dynacam, then the sudo line it prints, as admin

# Firewall: nothing in except the live view from the venue LAN (and SSH from the LAN)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.1.0/24 to any port 8090 proto tcp   # your venue's subnet
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp     # or only over the VPN
sudo ufw enable

# Hide other accounts' processes: ffmpeg's command line holds the camera passwords
echo 'proc /proc proc defaults,hidepid=2 0 0' | sudo tee -a /etc/fstab
sudo mount -o remount,hidepid=2 /proc

# Security updates by themselves
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

**SSH:** in `/etc/ssh/sshd_config`, set `PasswordAuthentication no` and `PermitRootLogin no`, and
use keys only. Then `sudo systemctl restart ssh`. If you don't need SSH, remove it with
`sudo apt remove openssh-server`.

**Disk encryption (optional):** LUKS with TPM unlock (`systemd-cryptenroll --tpm2-device=auto`)
lets the box restart by itself after a power cut. Without TPM unlock, someone has to type a
password at every boot, so don't use it on an unattended box.

## 4. Mac

- [ ] **Box account:** System Settings → Users & Groups → add a **Standard** user (not
      Administrator) for the box. Install and run `edge` under it, and turn on automatic login
      for that user only.
- [ ] **Internal disk only.** Don't run `edge` from an external drive. macOS usually mounts those
      with *Ignore ownership on this volume* (`mount` shows `noowners`), which lets every account
      read every file whatever its permissions, and the drive can be unplugged and carried off.
      If it must stay external: Finder → the drive → Get Info → untick **Ignore ownership on this
      volume**.
- [ ] **Firewall:** System Settings → Network → Firewall → **on**. In Options, allow **node**,
      and turn on **Stealth mode**.
- [ ] **Remote Login** (SSH) is **off** under General → Sharing, unless you need it. If you do,
      use keys only, and only over the VPN.
- [ ] **Updates:** General → Software Update → Automatic updates → install **Security Responses
      and system files**.
- [ ] **FileVault:** it protects the videos if the Mac is stolen, but after a power cut the Mac
      waits at the password screen and records nothing until someone signs in. Use it only where
      the Mac is on a UPS and staff can sign in.
- [ ] **File permissions:** the box makes its own files private. To check:
      `ls -ld edge/.env edge/data` shows `-rw-------` and `drwx------`.

## 5. Windows

The install guide puts the box in `C:\dgsports`, which every account on the PC can read by
default. Tighten that, and run the box without admin rights:

- [ ] **Box account:** run the box under a **Standard** account (Settings → Accounts → Other
      users). Do the admin steps from a separate admin account. Auto sign-in (`netplwiz`) is for
      the box account only.
- [ ] **Folder access:** in **Admin PowerShell** (replace `boxuser` with the box account):

      ```powershell
      icacls C:\dgsports /inheritance:r /grant:r "boxuser:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F"
      ```

- [ ] **pm2 without admin rights:** the start-on-boot task (install guide Part G step 2) is
      registered **as the box account** with `-RunLevel Limited`. A box set up before CR-044 has
      `-RunLevel Highest`: delete the task in Task Scheduler and register it again.
- [ ] **Firewall:** limit the live-view rule to the venue network:

      ```powershell
      Set-NetFirewallRule -DisplayName "DGSports live view" -RemoteAddress LocalSubnet
      ```

- [ ] **Remote Desktop** off (Settings → System → Remote Desktop) unless needed. If it's on,
      reach it only over the VPN.
- [ ] **Windows Update** on, with automatic restarts outside opening hours.
- [ ] **BitLocker** (Windows Pro) with TPM unlock: it protects the videos and the token if the PC
      is stolen, and still starts by itself after a power cut. Turn it on.

## 6. Cameras and the venue network

- [ ] Each camera has its **own strong Camera Account password**, not the Tapo app login, not a
      test password, and not the same at every venue. If you change it, update the court's camera
      address in Admin.
- [ ] Camera firmware is up to date, and anything you don't use (ONVIF, other accounts) is off.
- [ ] The box is wired.
- [ ] The cameras and the box are **not on the guest Wi-Fi**. Where the router can, give them
      their own network or VLAN that session devices can still reach on port 8090.
- [ ] Give the box and the cameras fixed IP addresses (router reservations).
- [ ] After any network change, a session device still shows the live view.

## 7. Regular checks

| When | Check |
| --- | --- |
| Monthly | `npm run boxes` in `back/`: only known boxes, and every one recently seen. Revoke anything unknown. |
| Monthly | Each box's log has no `security:` lines; disk space is fine (Admin → the venue's box health). |
| Each release | Every box updated (section 2). |
| Each install | Enrolment back off afterwards (section 1). |

## 8. A box is stolen, lost or tampered with

Do these **in order, the same day**:

1. **Revoke it.** On the server, in `back/`: `npm run boxes:revoke -- <box name or id>`. The
   cloud refuses it at once. If it comes back online, it stops and writes `revoked.json`.
2. **Change every camera password at that venue** (Tapo app → the camera → Advanced → Camera
   Account), then update each court's camera address in Admin → Courts.
3. **Reset the venue's live-stream keys** on YouTube/Facebook, then update them in Admin.
4. **Change the enrol key** if that box's `.env` still had it: set a new `RECORDER_ENROLL_KEY` (or
   leave it cleared, section 1) and restart the API.
5. **Check the courts' Google Drive folders** for odd shares or files. The box never held the
   Drive sign-in, but its videos were on its disk.
6. **Install a replacement** with a fresh enrolment (section 1), and harden it (sections 2–5).
7. Write down what happened and when, for the venue.

**A box being retired** (not stolen): revoke it, delete the `edge` folder, and wipe or reformat
the disk before it leaves.
