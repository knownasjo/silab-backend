# SILAB Backend

API untuk SILAB — sistem pengelolaan praktikum laboratorium Program Studi
Sistem Informasi, Universitas Ahmad Dahlan. Proyek skripsi dengan fokus utama
pada **presensi mahasiswa berbasis QR code**.

Repo pasangannya: `silab-admin` (frontend web Next.js).

## Stack

- Express 5 + TypeScript
- Prisma 6, PostgreSQL di Supabase
- JWT (accessToken 15 menit, refreshToken 24 jam)
- bcryptjs, 10 salt rounds

## Menjalankan

```bash
npm install
npm run dev        # nodemon + ts-node, port 3000
```

**Wajib Node.js 22 LTS.** Node 24+ tidak bisa — dependensi
`buffer-equal-constant-time` memakai `SlowBuffer` yang sudah dihapus dari Node.
Gejalanya: `TypeError: Cannot read properties of undefined (reading 'prototype')`.

### Environment

File `.env` di root (tidak di-commit; salin dari `.env.example`). Nilai JWT
bisa dibuat dengan
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

```
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...pooler.supabase.com:5432/postgres"
JWT_SECRET=...
JWT_REFRESH_SECRET=...
QR_TOKEN_PERIOD_SECONDS=10   # opsional, bawaan 10
SMTP_HOST=smtp.gmail.com     # opsional, bawaan smtp.gmail.com
SMTP_PORT=465                # opsional, bawaan 465
SMTP_USER=alamat@webmail.uad.ac.id
SMTP_PASS=...                # App Password Google (16 huruf, tanpa spasi)
MAIL_FROM_NAME=SILAB         # opsional
```

`DATABASE_URL` dan `DIRECT_URL` dibaca Prisma lewat `schema.prisma`, bukan oleh
kode aplikasi. `src/app.ts` memanggil `dotenv.config()` di baris paling atas —
ini wajib, karena `client.prisma.ts` membuat `PrismaClient` saat modulnya
di-import.

Yang dibaca langsung oleh kode (lewat `src/config/env.config.ts`) hanya
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `QR_TOKEN_PERIOD_SECONDS`, dan variabel
`SMTP_*`/`MAIL_FROM_NAME`. Selama `SMTP_USER`/`SMTP_PASS` kosong dan
`NODE_ENV` bukan `production`, kode verifikasi pendaftaran hanya dicetak di
terminal backend (`[SILAB] Kode verifikasi untuk ...`); di `production` tanpa
SMTP, pendaftaran ditolak dengan pesan "Layanan email belum dikonfigurasi!".

## Sejarah proyek

Tiga generasi kode:

1. **Backend MongoDB** (Sep 2024) — Express 4, Mongoose. Repo terpisah, tidak dipakai.
2. **Backend di IP kampus** `10.4.52.201:3001` — **repo hilang, server mati**.
   Dulu melayani aplikasi mobile Flutter dan folder `app/actions/` di frontend
   web. Endpointnya berbentuk jamak (`/announcements`, `/registrations`).
3. **Backend ini** (Mei 2025–sekarang) — dibangun ulang dari nol karena
   generasi 2 hilang. Endpoint berbentuk tunggal.

Aplikasi mobile Flutter (`silab-mobile`) sudah disambungkan ke backend ini;
lihat bagian "Endpoint untuk aplikasi mobile" dan README `silab-mobile`.

## Alur bisnis

1. Laboran membuat mata kuliah (`POST /subject`) dan kelas (`POST /class`)
2. Mahasiswa mendaftar mata kuliah (`POST /activation`) → status `false`
3. Pembayaran **offline**; laboran menandai lunas (`PUT /activation/:id`)
   dan sekaligus memilih kelas lewat `classId` di body
4. Asisten/laboran membuat pertemuan (`POST /meeting`) — token 6 karakter
   digenerate otomatis
5. Asisten/laboran membuka sesi presensi (`PUT /meeting/:id/status`)
6. Asisten/laboran menampilkan QR (`GET /meeting/:id/qr`); token di dalamnya
   berganti setiap 10 detik
7. Mahasiswa scan QR berisi token → presensi tercatat

Jalur alternatif (dipakai aplikasi mobile): setelah lunas, mahasiswa memilih
kelasnya sendiri lewat `GET /class/registration` → `POST /class/registration`.
Aturannya sama dengan saat laboran menetapkan kelas dari web: mata kuliahnya
harus sudah lunas, satu kelas per mata kuliah, dan kuota belum penuh. Mata
kuliah yang sudah punya kelas tidak ditawarkan lagi.

Catatan: `trn_activations` hanya menyimpan `subjectId`, **bukan** `classId`.

## Daftar endpoint

| Method | Path | Role |
|---|---|---|
| POST | `/auth/login` | publik |
| POST | `/auth/refresh` | publik (dengan refresh token) |
| POST | `/auth/register` | publik (email kampus, lihat "Pendaftaran akun mahasiswa") |
| POST | `/auth/register/verify` | publik |
| POST | `/auth/register/resend` | publik |
| GET | `/auth/me` | login |
| POST | `/subject` | LABORAN |
| GET | `/subject` | login |
| GET | `/subject/:id` | login |
| POST | `/class` | LABORAN |
| GET | `/class` | login |
| GET | `/class/registration` | MAHASISWA |
| POST | `/class/registration` | MAHASISWA |
| GET | `/class/me` | MAHASISWA |
| GET | `/class/:id` | login |
| GET | `/class/:id/classmates` | login (MAHASISWA hanya kelasnya sendiri) |
| POST | `/activation` | MAHASISWA |
| GET | `/activation?status=&name=` | login |
| PUT | `/activation/:id` | LABORAN |
| PUT | `/activation/:id/class` | LABORAN |
| POST | `/meeting` | ASISTEN, LABORAN |
| GET | `/meeting/:classId` | login |
| GET | `/meeting/:id/qr` | ASISTEN, LABORAN |
| PUT | `/meeting/:id/status` | ASISTEN, LABORAN |
| PUT | `/meeting/:id/attendances/:userId` | ASISTEN, LABORAN |
| DELETE | `/meeting/:id/attendances/:userId` | ASISTEN, LABORAN |
| POST | `/subject/classes/:classId/meetings/:meetingId/attendances` | MAHASISWA |
| POST | `/user` | LABORAN (buat akun role apa pun, langsung aktif) |
| GET | `/user/dosen` | login |
| GET | `/user/asisten?name=` | login |
| POST | `/announcement` | LABORAN |
| GET | `/announcement` | login |
| GET | `/announcement/:id` | login |
| PUT | `/announcement/:id` | LABORAN |
| DELETE | `/announcement/:id` | LABORAN |
| POST | `/collaborator` | **tanpa batas role** |
| GET | `/collaborator/:id` | login |
| GET | `/events` | login; stream SSE real-time |

### Endpoint presensi (inti skripsi)

```
POST /subject/classes/:classId/meetings/:meetingId/attendances
Authorization: Bearer <token mahasiswa>
Body: { "token": "S8Bxpm" }
→ 201
```

Jalur ini sama dengan yang dipanggil aplikasi Flutter
(`classes_api_service.dart`, fungsi `addUserAttendance`).

Urutan validasi: token wajib ada → role MAHASISWA → pertemuan milik kelas itu →
sesi sedang dibuka → token QR masih berlaku → mahasiswa peserta kelas → belum
pernah presensi.

### QR presensi berganti setiap 10 detik

Tujuannya mencegah titip absen lewat foto QR yang diteruskan ke teman yang
tidak hadir. Kodenya ada di `src/utils/QrToken/qr.token.ts`.

- **Pola TOTP (RFC 6238).** Token tidak disimpan di database. Token dihitung
  dari `HMAC-SHA256(kunci, "<meetingId>:<nomor periode>")`, dengan nomor
  periode = `floor(waktu / 10 detik)`, lalu diubah menjadi 6 karakter
  alfanumerik (62^6 ≈ 5,7 × 10^10 kemungkinan). Tidak perlu cron, dan QR
  yang tampil pasti cocok dengan validasi karena keduanya dihitung dari jam
  server yang sama.
- **Kunci HMAC** diturunkan dari `JWT_SECRET`
  (`HMAC-SHA256(JWT_SECRET, "silab-qr-token")`), jadi tidak perlu variabel
  `.env` baru. Siapa pun yang tahu `JWT_SECRET` memang sudah bisa memalsukan
  login, sehingga ini tidak menambah celah.
- **Masa berlaku.** Token periode sekarang dan satu periode sebelumnya sama-sama
  diterima, supaya mahasiswa yang memindai tepat sebelum QR berganti tidak
  ditolak. Sejak QR tampil, token berlaku 10–20 detik.
- **Pesan tolak.** Token yang sah dalam 10 menit terakhir dijawab "QR sudah
  kedaluwarsa, silakan scan ulang QR di layar!". Token lain dijawab "Token
  presensi tidak valid!".
- **Waktu penerimaan** dicatat sebelum query database, supaya lambatnya
  database tidak membuat scan yang tepat waktu dianggap kedaluwarsa.
- `GET /meeting/:id/qr` hanya melayani sesi yang sedang dibuka dan
  mengembalikan `{ token, period_seconds, expires_in_ms }`. Sisa waktu dihitung
  server, jadi frontend tidak bergantung pada jam laptop.
- Kolom `trn_meetings.token` masih diisi saat pertemuan dibuat (kolomnya
  wajib), tetapi **tidak lagi dipakai untuk validasi** dan tidak lagi dikirim
  oleh `GET /meeting/:classId`.
- Aplikasi Flutter tidak perlu diubah: QR tetap hanya berisi token, dan
  aplikasi mengirim apa pun yang dipindai.

### Endpoint untuk aplikasi mobile

Aplikasi mobile khusus mahasiswa. Semua data datang dari endpoint yang sama
dengan web; yang ditambahkan hanya data "milik saya":

| Kebutuhan layar mobile | Endpoint |
|---|---|
| Login, tolak akun non-mahasiswa | `POST /auth/login` lalu `GET /auth/me` (sekarang ikut mengirim `nim`) |
| Tetap masuk setelah 15 menit | `POST /auth/refresh` |
| Kelas terdaftar & jadwal | `GET /class/me` (baru) — jadwal dikelompokkan per hari di aplikasi |
| Tab Classmates | `GET /class/:id/classmates` (baru) — hanya `name` dan `is_me`, urut nama; mahasiswa yang bukan peserta kelas ditolak 403 |
| Status presensi per pertemuan | `GET /meeting/:classId` — untuk mahasiswa berisi `is_open`, `submitted_at`, `is_attended` miliknya sendiri, dan ditolak bila bukan peserta kelas |
| Daftar mata kuliah | `GET /subject` |
| Daftar & status pembayaran | `POST /activation`, `GET /activation` (sekarang ikut mengirim `created_at`) |
| Pilih kelas | `GET /class/registration`, `POST /class/registration` |
| Pengumuman | `GET /announcement`, `GET /announcement/:id` |
| Presensi QR | `POST /subject/classes/:classId/meetings/:meetingId/attendances` |

`app.listen(PORT)` mendengarkan di semua antarmuka jaringan, jadi HP di Wi-Fi
yang sama bisa memanggil `http://<IP-laptop>:3000` (izinkan port 3000 di
firewall bila perlu).

### Sesi login dan refresh token

Login mengembalikan `accessToken` (15 menit) dan `refreshToken` (1 hari).
Saat access token kedaluwarsa, middleware membalas **400 `jwt expired`**; web
dan mobile memakai pesan itu sebagai tanda untuk memanggil:

```
POST /auth/refresh   { "refreshToken": "..." }   ->   { "accessToken": "..." }
```

- 400 "Refresh token wajib dikirim!" bila body kosong.
- 401 "Sesi berakhir, silakan login kembali!" bila refresh token tidak sah,
  sudah kedaluwarsa, atau penggunanya sudah dihapus. Access token tidak bisa
  dipakai sebagai refresh token karena ditandatangani dengan secret lain
  (`JWT_SECRET` vs `JWT_REFRESH_SECRET`).
- Refresh token **tidak diperpanjang**, jadi sesi berakhir paling lambat 1 hari
  setelah login.

Web menyimpan refresh token di cookie `httpOnly` dan memperbaruinya lewat server
action; mobile memperbaruinya di `ApiClient` lalu mengulang permintaan.
Dengan begitu QR di layar asisten tidak hilang di tengah sesi.

### Pendaftaran akun mahasiswa

Mahasiswa mendaftar sendiri dari aplikasi mobile memakai email kampus
`namadepanNIM@webmail.uad.ac.id`. NIM diambil dari 10 angka sebelum `@`, role
selalu `MAHASISWA`, dan akun baru dibuat setelah kode dari email dimasukkan.

```
POST /auth/register         { email, fullname, password, confirmPassword }
  -> 201 { email, nim, expires_in: 600, resend_in: 60 }
POST /auth/register/verify  { email, code }   -> 201 { accessToken, refreshToken }
POST /auth/register/resend  { email }         -> 200 { email, nim, expires_in, resend_in }
```

- Pendaftaran yang belum diverifikasi disimpan di `trn_registrations`, bukan
  di `mst_user`, jadi tabel pengguna hanya berisi akun yang sudah terbukti.
  Password disimpan sebagai hash bcrypt dan kode sebagai HMAC-SHA256.
- Pendaftaran baru dengan email **atau** NIM yang sama menggantikan pendaftaran
  yang belum diverifikasi, sehingga orang yang mendaftar memakai NIM orang lain
  tidak bisa mengunci NIM tersebut. NIM/email baru terkunci setelah verifikasi.
- Kode 6 angka, berlaku 10 menit. Kirim ulang (lewat `/register` atau
  `/register/resend`) baru boleh 60 detik setelah kiriman terakhir (429).
- Maksimal 5 kali salah; percobaan dihitung dengan `updateMany` bersyarat
  `attempts < 5`, jadi tebakan serentak pun hanya diperiksa 5 kali. Setelah itu
  harus minta kode baru, yang mengembalikan hitungan ke 0.
- Login dengan NIM yang masih menunggu verifikasi dan password yang cocok
  dibalas **403** `Akun belum diverifikasi...` dengan `data: { email }`, supaya
  aplikasi bisa membuka layar verifikasi.
- Pesan: 400 format email/nama (3–100 karakter)/password (min. 8)/konfirmasi,
  409 "Email sudah terdaftar" atau "NIM sudah terdaftar", 404 "Pendaftaran
  tidak ditemukan", 400 "Kode salah. Sisa n percobaan", 400 "Kode sudah
  kedaluwarsa".

Akun staf dan akun uji dibuat laboran lewat `POST /user` (`Authorization`
laboran) dengan body `{ email, nim, fullname, password, role }`: email bebas,
NIM angka, password min. 8, role salah satu `UserRole`. Akun langsung aktif dan
menggantikan pendaftaran belum terverifikasi dengan email/NIM yang sama.

### Pembaruan real-time (SSE)

`GET /events` membuka satu stream Server-Sent Events per pengguna. Web admin
dan aplikasi mobile membukanya sekali setelah login, lalu memuat ulang data
yang sedang tampil setiap kali ada event, sehingga tidak perlu refresh.

| Event | Isi | Dikirim saat | Penerima |
|---|---|---|---|
| `ready` | `{}` | stream baru tersambung | pembuka stream |
| `announcement` | `announcement_id`, `action` (`created`/`updated`/`deleted`) | pengumuman dibuat, diubah, dihapus | semua |
| `subject` | `subject_id` | mata kuliah ditambah | semua |
| `class` | `class_id` (+ `action: "created"` untuk kelas baru) | kelas baru, peserta kelas berubah (pilih kelas, ditetapkan atau dipindah laboran), asisten ditambah | semua |
| `activation` | `{}` | mahasiswa mendaftar mata kuliah, status bayar diubah, kelas ditetapkan atau dipindah, mahasiswa memilih kelas | laboran/asisten, dan mahasiswa yang bersangkutan |
| `meeting` | `class_id`, `meeting_id` | pertemuan ditambah, sesi presensi dibuka/ditutup | laboran/asisten, dan peserta kelas itu |
| `attendance` | `class_id`, `meeting_id` | presensi masuk lewat scan, diubah manual, atau dihapus | laboran/asisten, dan mahasiswa yang presensinya berubah |
| `ping` | `{}` | setiap 25 detik | semua, untuk menjaga koneksi |

- Event hanya memberi tahu **apa** yang berubah, bukan datanya. Klien memanggil
  ulang endpoint biasa (`GET /announcement`, `/activation`, `/class/me`,
  `/meeting/:classId`, dan seterusnya), jadi aturan akses data tetap sama dan
  mahasiswa tidak pernah menerima data mahasiswa lain.
- Laboran, asisten, dan dosen menerima semua event. Mahasiswa hanya menerima
  event umum, event miliknya sendiri, dan event pertemuan kelas yang ia ikuti.
- Token dikirim lewat header `Authorization` seperti endpoint lain. Server
  menutup stream saat access token habis; klien memperbarui token lalu
  tersambung lagi.
- Klien tersambung ulang otomatis (jeda 1, 2, 4, ... paling lama 30 detik) bila
  koneksi putus, termasuk saat nodemon memulai ulang backend, atau bila tidak
  ada data selama 60 detik. Setiap kali tersambung ulang (event `ready`) data
  dimuat ulang, sehingga perubahan selama koneksi putus tidak terlewat.
- Pengiriman event ada di `src/utils/RealtimeEvents/realtime.events.ts`,
  dipanggil dari service setelah data tersimpan.
- `GET /announcement` dan `GET /activation` diurutkan dari yang terbaru.
  Sebelumnya urutannya mengikuti urutan fisik tabel, sehingga pengumuman baru
  muncul di halaman terakhir carousel dan baris aktivasi berpindah posisi
  setiap kali diperbarui.

### Aturan lain yang sudah diberlakukan

- **Nama pertemuan diseragamkan.** Pola "pertemuan &lt;angka&gt;" dalam penulisan
  apa pun menjadi `Pertemuan <angka>`. Nama lain (misal "Responsi") dibiarkan,
  hanya dirapikan spasinya.
- **Nama pertemuan tidak boleh ganda** dalam satu kelas (pemeriksaan di tingkat
  aplikasi, bukan constraint database).
- **Pindah kelas ditolak** bila mahasiswa sudah punya catatan presensi di kelas
  lama. Laboran harus menghapus presensinya dulu lewat
  `DELETE /meeting/:id/attendances/:userId`.
- **Hapus pengumuman bersifat soft delete** — `deleted_at` diisi, baris tetap ada.
- **`GET /meeting/:classId` diurutkan menurut `createdAt` naik**, supaya urutan
  pertemuan stabil di dropdown dan kolom rekap presensi.

## Bahasa pesan

Tiga service sudah berbahasa Indonesia: `activation`, `attendance`, `meeting`,
dan sebagian `announcement`.

Belum: `auth`, `subject`, `class`, `user`, `collaborator`. Jadi login masih
menjawab "Login Successful". Pengecualian di `auth`: login yang gagal
menjawab "NIM atau password salah!" (sebelumnya "Email or password invalid!",
padahal login memakai NIM), dan `POST /auth/refresh` sudah berbahasa
Indonesia.

## Akun uji

Pola password: fullname dalam huruf kecil.

| NIM | Password | Role |
|---|---|---|
| 2000016002 | laboran002 | LABORAN |
| 2000016001 | laboran001 | LABORAN |
| 2000016099 | mahasiswa001 | MAHASISWA |
| 2000016101 | asisten001 | ASISTEN |
| 2000016201 | dosen001 | DOSEN |

Password akun `2000016123` (Jordan) tidak diketahui.

Data uji: kelas `652fb265-0d30-45c6-90eb-b37b1c3f3127` (Algoritma dan
Pemrograman, kelas A), pertemuan `cc6434e9-8701-4955-a1ed-6ed4a723b4f1`
(Pertemuan 1).

## Batasan yang disadari (untuk bab batasan skripsi)

1. **Tidak ada periode akademik.** `mst_subject.semester` adalah semester
   kurikulum, bukan tahun ajaran. Akibatnya data aktivasi menumpuk selamanya
   dan halaman Pembayaran menampilkan seluruh angkatan.
2. **Mahasiswa tidak bisa mengulang mata kuliah.** `trn_activations` punya
   `@@unique([userId, subjectId])`, sehingga satu mahasiswa hanya boleh punya
   satu aktivasi per mata kuliah — selamanya. Solusinya menambah atribut
   periode akademik lalu mengubah constraint menjadi
   `@@unique([userId, subjectId, academicPeriod])`.
3. **Kolom `deleted_at` hampir tidak dipakai.** Hanya pengumuman yang
   memakainya. Tabel lain punya kolomnya tapi tidak pernah diisi.
4. **Mahasiswa yang status bayarnya dibatalkan tetap berada di kelas.**
5. **Tidak ada endpoint "kelas yang saya ampu"** untuk asisten. `GET /class`
   mengembalikan semua kelas tanpa penyaring peran.
6. **QR yang berganti hanya menghentikan titip absen tertunda** (lewat foto).
   Siaran langsung, misalnya teman di kelas melakukan video call lalu
   mahasiswa yang absen memindai dari layar saat itu juga, tetap bisa lolos.
7. **Titip akun tidak tercegah.** Mahasiswa yang absen bisa memberikan NIM dan
   password ke teman yang hadir, lalu teman itu memindai dari HP-nya sendiri.
   Penangkalnya adalah membatasi satu perangkat untuk satu akun per pertemuan,
   yang butuh perubahan di aplikasi mobile.
8. **Refresh token tidak bisa dicabut.** Token tidak disimpan di database,
   jadi Keluar hanya menghapusnya dari perangkat. Refresh token yang dicuri
   tetap berlaku sampai habis masanya (paling lama 1 hari). Pencabutan butuh
   tabel sesi.
9. **Pembaruan real-time hanya untuk satu proses server.** Pendengar SSE
   disimpan di memori, jadi bila backend dijalankan lebih dari satu instance,
   event dari satu instance tidak sampai ke klien yang tersambung ke instance
   lain. Hosting serverless yang memutus koneksi panjang juga tidak cocok.
   Solusinya Redis pub/sub atau `LISTEN/NOTIFY` Postgres di antara instance.

## Pekerjaan yang masih tersisa

- [ ] Folder `node_modules/` ikut ter-commit (6.407 file), termasuk Prisma client
      hasil generate yang berubah setiap kali lokasi repo berbeda
- [ ] Batasi role pada `POST /collaborator`
- [ ] Seragamkan pesan lima service sisanya ke bahasa Indonesia

## Catatan lain

- CORS terbuka untuk semua origin (`app.use(cors())`)
