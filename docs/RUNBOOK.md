# RUNBOOK — Indotek Budget (production)

Semua perintah bisa langsung di-copy-paste. Ganti placeholder `{{…}}` dengan nilai asli:

| Placeholder | Arti |
|---|---|
| `{{DOMAIN}}` | domain aplikasi, mis. `budget.indotek.co.id` |
| `{{EMAIL_ADMIN}}` | email admin (Let's Encrypt + akun admin awal) |
| `{{GHCR_OWNER}}` | user/organisasi GitHub pemilik repo (huruf kecil) |
| `{{SERVER_IP}}` | IP publik VPS |
| `{{S3_ENDPOINT}}` `{{S3_BUCKET}}` `{{S3_REGION}}` | object storage untuk backup |

Folder aplikasi di server: **`/opt/indotek`** (user **`deploy`**). Semua perintah server dijalankan dari folder itu
kecuali disebut lain.

## 0. Arsitektur singkat

```
Internet ─▶ Caddy :80/:443 (HTTPS Let's Encrypt, header keamanan)
              ├─ /api/* ─▶ api (NestJS, 1..n replika, user node) ─▶ postgres 16 (internal)
              │                                                 └▶ redis 7 (internal: rate limit, lock)
              └─ /*     ─▶ web (nginx-unprivileged, file statis)
backup (cron 02:00 WIB) ─▶ pg_dump + uploads ─▶ restic (terenkripsi) ─▶ object storage S3
```

Postgres dan Redis tidak punya port publik. Firewall hanya membuka 22, 80, 443.

---

## 1. Persiapan (di laptop, sekali)

### 1.1 Repo GitHub private + push pertama

```bash
cd ~/Documents/budget
git ls-files private/            # HARUS kosong (file asli berisi data pribadi tidak boleh ikut)
git ls-files | grep -E '\.env(\.|$)' | grep -v example   # HARUS kosong
gh auth login                    # sekali, bila belum
gh repo create {{GHCR_OWNER}}/indotek-budget --private --source . --remote origin
git branch -M main
git push -u origin main
```

Tanpa `gh`: buat repo **private** `indotek-budget` di github.com, lalu:

```bash
git remote add origin git@github.com:{{GHCR_OWNER}}/indotek-budget.git
git branch -M main && git push -u origin main
```

Tunggu workflow **CI** (tab *Actions*) hijau. Job *Build & push image* membuat 3 image di GHCR dengan tag = 7 karakter
pertama commit, mis. `ghcr.io/{{GHCR_OWNER}}/indotek-api:2826a9e`. **Catat tag ini** (juga terlihat di *Summary* job).

### 1.2 Token GHCR read-only untuk server

GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → *Generate new token*:

- Note: `indotek-server-ghcr-read`
- Expiration: 1 tahun (catat tanggal rotasi di kalender)
- Scope: **hanya `read:packages`**

Simpan token di password manager. Token ini dipakai sekali di server (`docker login`).

### 1.3 Deploy key read-only (server mengambil file konfigurasi dari repo)

Di server nanti (§3.1) akan dibuat SSH key; public key-nya dipasang di repo → Settings → **Deploy keys** → *Add deploy
key* → **jangan** centang *Allow write access*.

### 1.4 DNS

Buat A record `{{DOMAIN}}` → `{{SERVER_IP}}` (TTL 300). Cek dari laptop: `dig +short {{DOMAIN}}` → harus IP server
sebelum deploy pertama (Caddy butuh ini untuk sertifikat).

### 1.5 Object storage backup (S3-compatible, generik)

1. Buat bucket **private** `{{S3_BUCKET}}` (tanpa akses publik, tanpa website hosting).
2. Buat **access key khusus backup** (bukan key utama akun) dengan hak minimal hanya untuk bucket itu:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"], "Resource": "arn:aws:s3:::{{S3_BUCKET}}" },
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::{{S3_BUCKET}}/*" }
     ]
   }
   ```

   `DeleteObject` dibutuhkan restic untuk retensi (hapus snapshot lama) dan lock file.
3. Catat endpoint, region, access key id, secret key.

**Contoh: IDCloudHost Object Storage** (cek ulang nilai di panel IDCloudHost — panel bisa berubah):

| Item | Contoh |
|---|---|
| Endpoint | `https://is3.cloudhost.id` |
| Region | `us-east-1` (S3 API IDCloudHost menerima region default ini) |
| Bucket | `indotek-backup` (Visibility: **Private**) |
| Access key | buat *user/key* Object Storage **baru khusus backup**; jangan pakai key utama akun |

Hasilnya di `.env.production`:

```
S3_ENDPOINT=https://is3.cloudhost.id
S3_BUCKET=indotek-backup
S3_REGION=us-east-1
RESTIC_REPOSITORY=s3:https://is3.cloudhost.id/indotek-backup/indotek-budget
```

Bila panel mendukung bucket policy, pasang policy hak minimal di atas untuk key backup (principal = user key
tersebut). Bila tidak mendukung, minimal pastikan key itu milik user Object Storage terpisah yang hanya punya bucket ini.

---

## 2. Setup server (sekali, sebagai root)

```bash
ssh root@{{SERVER_IP}}
curl -fsSLo /root/server-setup.sh https://raw.githubusercontent.com/{{GHCR_OWNER}}/indotek-budget/main/scripts/server-setup.sh \
  || echo "Repo private: salin manual — lihat di bawah"
```

Repo private tidak bisa di-`curl` tanpa token; salin dari laptop:

```bash
scp scripts/server-setup.sh root@{{SERVER_IP}}:/root/
```

Lalu di server:

```bash
sudo bash /root/server-setup.sh
```

Script ini: update OS, timezone Asia/Jakarta, user `deploy` (authorized_keys root disalin), Docker resmi + compose,
ufw (22/80/443), fail2ban, unattended-upgrades (reboot otomatis 04:00 bila perlu), swap 2 GB, `/opt/indotek`.

**Jangan tutup sesi root.** Di terminal lain:

```bash
ssh deploy@{{SERVER_IP}}      # harus berhasil dengan SSH key
docker ps                     # harus jalan tanpa sudo (logout/login dulu bila 'permission denied')
```

Bila berhasil, kunci SSH (key-only, root dimatikan):

```bash
sudo bash /root/server-setup.sh --lock-ssh
```

---

## 3. Konfigurasi aplikasi (sebagai `deploy`)

### 3.1 Ambil file dari repo

```bash
ssh deploy@{{SERVER_IP}}
ssh-keygen -t ed25519 -C "indotek-server" -f ~/.ssh/github_indotek -N ""
cat ~/.ssh/github_indotek.pub     # → GitHub repo → Settings → Deploy keys (read-only), lihat §1.3
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_indotek
  IdentitiesOnly yes
EOF
git clone git@github.com:{{GHCR_OWNER}}/indotek-budget.git /opt/indotek
cd /opt/indotek
```

### 3.2 Secrets

```bash
cd /opt/indotek
./scripts/gen-secrets.sh {{DOMAIN}} {{EMAIL_ADMIN}} {{GHCR_OWNER}} {{S3_ENDPOINT}} {{S3_BUCKET}} {{S3_REGION}}
nano .env.production       # isi S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY; set TAG=<tag dari §1.1>
```

- Script mencetak **password admin awal** — simpan di password manager.
- Salin **`RESTIC_PASSWORD`** ke password manager. Tanpa password ini backup **tidak bisa dibuka**.
- `.env.production` otomatis `chmod 600`; jangan pernah di-commit atau dikirim lewat chat.

### 3.3 Login GHCR (token read-only §1.2)

```bash
read -rs GHCR_TOKEN && echo "$GHCR_TOKEN" | docker login ghcr.io -u {{GHCR_OWNER}} --password-stdin && unset GHCR_TOKEN
docker compose -p indotek -f docker-compose.prod.yml --env-file .env.production pull
```

---

## 4. Migrasi data dari DB lokal (sekali)

Data lokal berisi keputusan manual (mapping, split PO, termin, referensi) — **jangan re-import dari Excel**.

### 4.1 Di laptop: export (DB lokal tidak diubah)

```bash
cd ~/Documents/budget
docker compose up -d postgres
./scripts/export-local-db.sh                         # → migrasi/<tanggal>/
./scripts/prepare-migration.sh migrasi/<tanggal>     # DRY-RUN: tabel jumlah baris dihapus/dialihkan + cek Rekap
```

Periksa laporan dry-run. Setelah disetujui:

```bash
./scripts/prepare-migration.sh migrasi/<tanggal> --apply
# → indotek-final.dump, uploads-final.tar.gz, manifest-final.txt
ssh deploy@{{SERVER_IP}} 'mkdir -p /opt/indotek/migrasi && chmod 700 /opt/indotek/migrasi'
scp migrasi/<tanggal>/{indotek-final.dump,uploads-final.tar.gz,manifest-final.txt} deploy@{{SERVER_IP}}:/opt/indotek/migrasi/
```

### 4.2 Di server: import

```bash
cd /opt/indotek
./scripts/import-to-prod.sh migrasi
```

Script memverifikasi checksum, me-restore DB, menjalankan migrasi + seed (admin awal dari `ADMIN_EMAIL`), memulihkan
uploads, menyalakan stack, lalu mengecek: jumlah baris per tabel = manifest (User +1 admin awal), **Rekap sama
persis**, FundRequest = 0, akun aktif = 1, akun demo = 0. Harus berakhir dengan **`IMPORT LULUS`**.

Catat tag yang aktif:

```bash
./scripts/deploy.sh <tag-yang-sama-dengan-TAG-di-env> --no-backup
```

Setelah lulus, hapus file migrasi dari server dan laptop:

```bash
shred -u /opt/indotek/migrasi/*          # di server
rm -rf ~/Documents/budget/migrasi/<tanggal>   # di laptop (atau simpan terenkripsi bila perlu arsip)
```

---

## 5. Login pertama & akun asli

1. Buka `https://{{DOMAIN}}` → login `{{EMAIL_ADMIN}}` + password admin awal → **wajib ganti password**.
2. Siapkan CSV dari `docs/users.template.csv` (kolom `nama,email,role,jabatan,projects`; `projects` = kode project
   dipisah `;`, wajib untuk INVESTOR). Salin ke server lalu:

```bash
scp users.csv deploy@{{SERVER_IP}}:/opt/indotek/
ssh deploy@{{SERVER_IP}}
cd /opt/indotek && ./scripts/create-users.sh users.csv
cat akun-baru-*.csv          # password awal per orang — bagikan lewat kanal aman, satu per satu
shred -u akun-baru-*.csv users.csv
```

Setiap akun wajib mengganti password saat login pertama. Email yang sudah ada dilewati.

---

## 6. Monitoring

### 6.1 Uptime check eksternal (UptimeRobot atau sejenis)

- Monitor type: **HTTP(s) – Keyword**
- URL: `https://{{DOMAIN}}/api/health`
- Keyword: `"ok":true` (Alert when keyword **not exists**)
- Interval: 5 menit; timeout 30 detik
- Alert contact: `{{EMAIL_ADMIN}}` (+ Telegram/WA bila tersedia)
- Monitor kedua (opsional): **SSL expiry** untuk `{{DOMAIN}}`, peringatan 14 hari sebelum kedaluwarsa

`/api/health` mengembalikan 200 `{"ok":true,"version":"<tag>","checks":{"db":"ok","redis":"ok"}}`; 503 bila DB/Redis
bermasalah.

### 6.2 Log

Log aplikasi berupa JSON (satu baris per request, request id, status, durasi). Cookie, Authorization, X-API-Key,
X-CSRF-Token, dan password disamarkan.

```bash
cd /opt/indotek
alias dc='docker compose -p indotek -f docker-compose.prod.yml --env-file .env.production'
dc ps                                                   # status & health semua service
dc logs --tail 200 api                                  # log API
dc logs -f api | jq -c 'select(.level >= 40)'           # hanya warning/error (sudo apt install jq)
dc logs --since 1h caddy | jq -c 'select(.status >= 500)'
dc logs --tail 50 backup                                # hasil backup harian
df -h / && docker system df                             # disk
```

Log Docker dibatasi 10 MB × 5 file per container.

---

## 7. Deploy rilis baru

1. Push ke `main` → tunggu CI hijau → catat tag (7 karakter commit).
2. Di server:

```bash
cd /opt/indotek
git pull                                  # bila compose/Caddyfile/script berubah
./scripts/deploy.sh <tag>
```

`deploy.sh` melakukan: pull image → **backup pre-deploy** → `prisma migrate deploy` → seed (insert-only) → `up -d` →
cek `https://{{DOMAIN}}/api/health` harus melaporkan versi `<tag>` dalam ±90 detik. Gagal → **otomatis kembali ke tag
sebelumnya**.

Scale API (opsional, mis. jam sibuk): `dc up -d --scale api=2` — rate limit & lock tetap konsisten lewat Redis.

## 8. Rollback

### 8.1 Image saja (tanpa perubahan skema DB)

```bash
./scripts/deploy.sh --rollback            # ke tag sebelumnya (.deploy/indotek/previous_tag)
./scripts/deploy.sh <tag-lama>            # atau tag tertentu
```

### 8.2 Bila rilis membawa migrasi DB yang harus dibatalkan

Migrasi Prisma bersifat maju (forward-only). Kembalikan DB ke snapshot **pre-deploy** rilis tersebut:

```bash
dc exec backup restic snapshots --host indotek --tag pre-deploy    # pilih ID sebelum rilis bermasalah
./scripts/restore.sh <snapshot-id>                                  # ketik RESTORE
./scripts/deploy.sh <tag-lama> --no-backup
```

Data yang masuk setelah snapshot itu hilang — catat dan input ulang.

---

## 9. Backup & restore

- **Otomatis**: setiap hari 02:00 WIB (container `backup`): `pg_dump` + folder uploads → restic (terenkripsi
  AES-256 dengan `RESTIC_PASSWORD`) → `{{S3_BUCKET}}`. Retensi **14 harian + 8 mingguan**. Cek integritas tiap Minggu
  04:00 WIB. Healthcheck container `backup` menjadi *unhealthy* bila backup terakhir > 26 jam.
- **Manual**: `./scripts/backup-now.sh` (opsional tag: `./scripts/backup-now.sh sebelum-perubahan-besar`)
- **Daftar snapshot**: `dc exec backup restic snapshots --host indotek`
- **Cek integritas manual**: `dc exec backup check.sh`
- **Restore**: `./scripts/restore.sh latest` atau `./scripts/restore.sh <snapshot-id>` (API dihentikan sementara,
  DB & uploads ditimpa).

### 9.1 Uji restore (wajib tiap bulan, di laptop — tidak mengganggu production)

```bash
cd ~/Documents/budget
cp .env.production.example /tmp/env.restoretest   # isi: DOMAIN=localhost, HTTP_PORT=8081, HTTPS_PORT=8444,
                                                  # S3_* & RESTIC_* SAMA dengan production, TAG=<tag production>,
                                                  # secret lain boleh acak (./scripts/gen-secrets.sh dengan ENV_OUT)
docker compose -p indotek-restoretest -f docker-compose.prod.yml --env-file /tmp/env.restoretest up -d postgres redis backup
./scripts/restore.sh latest --env-file /tmp/env.restoretest --project indotek-restoretest </dev/null
docker compose -p indotek-restoretest -f docker-compose.prod.yml --env-file /tmp/env.restoretest up -d
docker compose -p indotek-restoretest -f docker-compose.prod.yml --env-file /tmp/env.restoretest exec api node dist-scripts/scripts/rekap-snapshot.js | tail -1
```

Bandingkan `REKAP_SHA256` dengan hasil perintah yang sama di server (`dc exec api node dist-scripts/scripts/rekap-snapshot.js | tail -1`,
dijalankan setelah backup terakhir dan sebelum ada perubahan data). Catat tanggal uji & hasilnya. Setelah selesai:

```bash
docker compose -p indotek-restoretest -f docker-compose.prod.yml --env-file /tmp/env.restoretest down -v && shred -u /tmp/env.restoretest
```

Bukti uji otomatis (lokal, S3 tiruan): `scripts/acceptance/backup-restore.sh` → backup → hapus DB → restore → Rekap sama
persis.

---

## 10. User & akses

| Tugas | Perintah / langkah |
|---|---|
| Tambah user | §5 (`./scripts/create-users.sh users.csv`) |
| Reset password | `./scripts/reset-password.sh email@domain` → password sementara (wajib ganti, semua sesi dicabut) |
| Nonaktifkan user | `./scripts/user-status.sh email@domain nonaktif` (tidak bisa login, semua sesi dicabut); aktifkan lagi: `… aktif` |
| Akses investor ke project | Aplikasi (ADMIN): Data Master → akses investor per project |

## 11. Rotasi secret

| Secret | Cara | Efek |
|---|---|---|
| **API key webhook** (bot Telegram/n8n) | Aplikasi (ADMIN) → Pengaturan → API key → *Buat* key baru (ditampilkan sekali) → pasang di bot → uji kirim → *cabut* key lama | Bot memakai key baru; key lama langsung ditolak setelah dicabut |
| `COOKIE_SECRET` | `nano .env.production` → ganti dengan `openssl rand -base64 48 \| tr -d '/+=\n'` → `dc up -d api` | Semua token CSRF lama tidak valid → **semua user harus login ulang** |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | sama seperti di atas | Semua sesi berakhir → semua user login ulang |
| `POSTGRES_PASSWORD` | `dc exec postgres psql -U indotek -c "alter user indotek password '<baru>'"` → ubah `.env.production` → `dc up -d` | Tidak ada efek ke user |
| `REDIS_PASSWORD` | ubah `.env.production` → `dc up -d redis api` | Hitungan rate limit ter-reset |
| Token GHCR | buat token baru (§1.2) → `docker login ghcr.io` ulang → hapus token lama di GitHub | — |
| `RESTIC_PASSWORD` | `dc exec backup restic key add` (masukkan password baru) → ubah `.env.production` → `dc up -d backup` → `dc exec backup restic key list` → `restic key remove <id-lama>` | Simpan password baru di password manager |

## 12. Insiden

| Gejala | Cek |
|---|---|
| Situs tidak bisa dibuka | `dc ps`; `dc logs --tail 100 caddy`; DNS `dig +short {{DOMAIN}}`; `sudo ufw status` |
| Sertifikat gagal | `dc logs caddy | grep -i acme`; port 80 harus terbuka; DNS harus mengarah ke server. Batas Let's Encrypt: uji dulu dengan `ACME_CA` staging |
| 502/503 dari `/api` | `dc ps api` (health), `dc logs --tail 200 api`; DB: `dc exec postgres pg_isready` |
| Login selalu 429 | Rate limit (5 / menit per IP+email): tunggu; cek Redis `dc exec redis redis-cli -a "$REDIS_PASSWORD" ping` |
| PDF gagal | `dc logs api | grep -i chromium`; memori: `docker stats` (naikkan `API_MEM_LIMIT`) |
| Disk penuh | `docker system df`; `docker image prune -a` (hapus image tag lama yang tidak dipakai rollback) |
| Backup unhealthy | `dc logs --tail 100 backup`; kredensial S3; `dc exec backup restic snapshots` |
| Deploy gagal & rollback juga gagal | `dc logs api`; deploy tag terakhir yang diketahui baik: `./scripts/deploy.sh <tag> --no-backup`; bila DB rusak → §8.2 |
