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
SMTP_PASS=...                # App Password Google (16 huruf, spasi diabaikan)
MAIL_FROM_NAME=SILAB         # opsional
```

`DATABASE_URL` dan `DIRECT_URL` dibaca Prisma lewat `schema.prisma`, bukan oleh
kode aplikasi. `src/app.ts` memanggil `dotenv.config()` di baris paling atas —
ini wajib, karena `client.prisma.ts` membuat `PrismaClient` saat modulnya
di-import.

Yang dibaca langsung oleh kode (lewat `src/config/env.config.ts`) hanya
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `QR_TOKEN_PERIOD_SECONDS`, dan variabel
`SMTP_*`/`MAIL_FROM_NAME`. Selama `SMTP_USER`/`SMTP_PASS` kosong dan
`NODE_ENV` bukan `production`, kode verifikasi pendaftaran dan kode reset
password hanya dicetak di terminal backend (`[SILAB] Kode verifikasi untuk ...`
dan `[SILAB] Kode reset password untuk ...`); di `production` tanpa SMTP,
permintaan kode ditolak dengan pesan "Layanan email belum dikonfigurasi!".

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

1. Laboran membuat mata kuliah (`POST /subject`) dan kelas (`POST /class`),
   lalu bisa mengubah mata kuliah termasuk dosen pengampunya
   (`PUT /subject/:id`) serta mengubah atau menghapus kelas
   (`PUT`/`DELETE /class/:id`)
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
| POST | `/auth/password/forgot` | publik (akun MAHASISWA, lihat "Lupa password") |
| POST | `/auth/password/reset` | publik |
| GET | `/auth/me` | login |
| PUT | `/auth/me` | login (ganti nama sendiri, lihat "Profil dan ganti password") |
| PUT | `/auth/me/password` | login (ganti password sendiri) |
| POST | `/subject` | LABORAN (aturannya sama dengan ubah mata kuliah) |
| GET | `/subject` | login (DOSEN: hanya mata kuliah yang ia ampu). Berisi `lecturer_id`, urut menurut waktu dibuat |
| GET | `/subject/:id` | login (DOSEN: hanya mata kuliah yang ia ampu) |
| PUT | `/subject/:id` | LABORAN (lihat "Tambah dan ubah mata kuliah") |
| POST | `/class` | LABORAN (lihat "Tambah kelas dan jam sesi") |
| GET | `/class` | login (MAHASISWA: hanya kelas yang ia pegang sebagai asisten; DOSEN: hanya kelas mata kuliah yang ia ampu). Berisi `sessionId` tiap kelas |
| GET | `/class/registration` | MAHASISWA |
| POST | `/class/registration` | MAHASISWA |
| GET | `/class/me` | MAHASISWA |
| GET | `/class/:id` | login (DOSEN: hanya kelas mata kuliah yang ia ampu) |
| PUT | `/class/:id` | LABORAN (lihat "Ubah dan hapus kelas") |
| DELETE | `/class/:id` | LABORAN (hanya kelas yang belum punya presensi) |
| GET | `/class/:id/classmates` | login (MAHASISWA hanya kelasnya sendiri, DOSEN hanya kelas mata kuliah yang ia ampu) |
| GET | `/session?day=&active=` | login (jam sesi; `day` = hari kelas, `active=true` = hanya yang aktif) |
| POST | `/session` | LABORAN |
| PUT | `/session/:id` | LABORAN (ubah jam, nomor, atau status aktif) |
| DELETE | `/session/:id` | LABORAN (hanya sesi yang belum dipakai kelas) |
| POST | `/activation` | MAHASISWA |
| GET | `/activation?status=&name=` | LABORAN, MAHASISWA (hanya miliknya); DOSEN ditolak |
| PUT | `/activation/:id` | LABORAN |
| PUT | `/activation/:id/class` | LABORAN |
| POST | `/meeting` | LABORAN, asisten kelas itu |
| GET | `/meeting/:classId` | login (DOSEN: hanya kelas mata kuliah yang ia ampu) |
| GET | `/meeting/:id/qr` | LABORAN, asisten kelas itu |
| PUT | `/meeting/:id` | LABORAN, asisten kelas itu (ubah judul) |
| DELETE | `/meeting/:id` | LABORAN, asisten kelas itu (hanya pertemuan tanpa presensi yang sesinya ditutup) |
| PUT | `/meeting/:id/status` | LABORAN, asisten kelas itu |
| PUT | `/meeting/:id/attendances/:userId` | LABORAN, asisten kelas itu |
| DELETE | `/meeting/:id/attendances/:userId` | LABORAN, asisten kelas itu |
| POST | `/subject/classes/:classId/meetings/:meetingId/attendances` | MAHASISWA |
| POST | `/user` | LABORAN (buat akun role apa pun, langsung aktif) |
| PUT | `/user/:niyAtauId/password` | LABORAN (ganti password akun LABORAN/DOSEN) |
| GET | `/user/dosen` | LABORAN (pilihan dosen pengampu) |
| GET | `/user/mahasiswa?name=` | LABORAN (calon asisten, cari nama/NIM, maks. 20) |
| POST | `/announcement` | LABORAN |
| GET | `/announcement` | login |
| GET | `/announcement/:id` | login |
| PUT | `/announcement/:id` | LABORAN |
| DELETE | `/announcement/:id` | LABORAN |
| POST | `/collaborator` | LABORAN |
| GET | `/collaborator/:id` | login (DOSEN: hanya kelas mata kuliah yang ia ampu) |
| DELETE | `/collaborator/:classId/:userId` | LABORAN |
| GET | `/events` | login; stream SSE real-time |
| GET | `/dashboard/dosen` | DOSEN (angka dashboard, lihat "Akses dosen") |

### Koleksi Postman

`docs/SILABV2.postman_collection.json` berisi 65 request untuk semua endpoint
di atas, dikelompokkan per fitur, masing-masing dengan keterangan peran dan
balasan yang diharapkan. Import ke Postman, lalu:

1. Jalankan request di folder **Auth**. Token laboran, mahasiswa, dosen, dan
   asisten tersimpan otomatis ke variabel koleksi.
2. Request yang mengubah data memakai akun baru dari folder **Pendaftaran
   Mahasiswa** (`newStudentEmail`, token `accessTokenBaru`) atau data baru
   (mata kuliah, akun dosen, pertemuan), jadi akun uji lain tidak berubah.
   Kode dari email diisi manual ke variabel `verificationCode` dan `resetCode`.
3. Skrip di beberapa request menyimpan id yang dibutuhkan request berikutnya
   (`newStudentId`, `activationId`, `meetingId`, `qrToken`, `announcementId`,
   `newClassId`).
4. Folder **Dosen** berisi semua yang bisa dibaca dosen: ringkasan dashboard,
   mata kuliah dan kelas yang diampu, presensi kelas, dan contoh penolakan data
   pembayaran.
5. Folder **Jam Sesi** membuat sesi contoh (Sesi 9 Jumat), mengubah, lalu
   menghapusnya. "Tambah Kelas" memakai variabel `sessionId` (Sesi 2
   Senin–Kamis). Bila sesi itu sudah dihapus dan dibuat ulang, "Semua Jam
   Sesi" mengganti `sessionId` dengan sesi Senin–Kamis aktif pertama.
6. Folder **Kelas** menambah kelas A untuk mata kuliah baru, mengubahnya
   ("Ubah Kelas"), lalu menghapusnya ("Hapus Kelas").

POST/PUT/DELETE mengubah data sungguhan. Akun mahasiswa hasil uji bisa dihapus
dengan `npm run hapus-akun <NIM>`.

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
- **Sesi dicabut saat password diganti.** `mst_user.password_changed_at` diisi
  setiap kali password diganti (lewat Lupa password maupun oleh laboran).
  Token yang dibuat sebelum waktu itu ditolak: access token dibalas
  `jwt expired`, refresh token dibalas 401, dan aliran SSE milik akun itu
  langsung diputus. Waktu itu dibulatkan ke bawah per detik (sama dengan `iat`
  JWT), jadi login dengan password baru di detik yang sama tetap sah.
- Access token milik akun yang sudah dihapus juga dibalas `jwt expired`, lalu
  refresh-nya 401.

Web dan mobile memperlakukan refresh 4xx sebagai sesi berakhir: token
dihapus lalu pengguna diarahkan ke halaman login (mobile menampilkan "Sesi Anda
berakhir, silakan masuk kembali."). Dengan pemutusan SSE, perangkat yang sedang
terbuka kembali ke login sekitar 1–2 detik setelah password diganti.

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
password min. 8, role MAHASISWA, LABORAN, atau DOSEN. Akun langsung aktif dan
menggantikan pendaftaran belum terverifikasi dengan email/nomor yang sama.
Gunakan email asli yang aktif untuk akun laboran dan dosen.

**NIM dan NIY.** Kolom `nim` di database dan field `nim` di API adalah nomor
induk untuk login. Mahasiswa mengisinya dengan NIM (angka), sedangkan dosen dan
laboran dengan **NIY** (Nomor Induk Yayasan), wajib tepat 8 angka ("NIY harus 8
angka!", "NIY sudah terdaftar!"). NIDN dosen belum disimpan karena belum ada
fitur yang membutuhkannya. Pesan login untuk semua peran: "NIM/NIY atau password
salah!".

### Lupa password

Mahasiswa mengganti password sendiri dari aplikasi mobile; kodenya dikirim ke
email akun.

```
POST /auth/password/forgot  { email }
  -> 200 { email, expires_in: 600, resend_in: 60 }
POST /auth/password/reset   { email, code, password, confirmPassword }
  -> 200 "Password berhasil diubah, silakan masuk."
```

- Hanya akun **MAHASISWA**. Akun LABORAN/DOSEN dibalas 403 "Reset password akun
  laboran dan dosen dilakukan oleh laboran."
- Email belum terdaftar: 404 "Email ini belum terdaftar di SILAB." Pesan ini
  sengaja jujur, karena halaman Daftar pun sudah memberi tahu email yang
  terdaftar. Email yang masih menunggu verifikasi: 403 "Akun ini belum
  diverifikasi, silakan selesaikan pendaftaran." dengan `data: { email }`, dan
  aplikasi membuka layar verifikasi pendaftaran.
- Kode disimpan di `trn_password_resets` (satu baris per akun, ikut terhapus
  bila akunnya dihapus). Aturannya sama dengan kode pendaftaran: 6 angka,
  berlaku 10 menit, minta ulang (panggil `/forgot` lagi) setelah 60 detik,
  maksimal 5 kali salah. Kode di-HMAC bersama id akun dengan awalan
  `password-reset:`, jadi tidak bisa tertukar dengan kode pendaftaran.
- Isian (6 angka, password min. 8, konfirmasi sama) diperiksa sebelum kode,
  jadi salah ketik password tidak mengurangi jatah percobaan.
- Setelah berhasil, permintaan reset dihapus dan semua sesi lama akun itu
  dicabut (lihat "Sesi login dan refresh token"). Email yang dikirim berjudul
  "123456 adalah kode reset password SILAB Anda".

Laboran dan dosen yang lupa password menghubungi laboran lain, yang lalu
mengganti password-nya:

```
PUT /user/60020001/password   { "password": "passwordbaru" }
  -> 200 "Password Dosen001 berhasil diganti"  { id, nim, fullname, role }
```

`:niyAtauId` boleh NIY atau id akun. Hanya LABORAN yang boleh memanggilnya, dan
hanya untuk akun LABORAN/DOSEN; akun mahasiswa ditolak 403 agar mahasiswa
memakai Lupa password. Sesi lama akun itu ikut dicabut. Bila laboran mengganti
password-nya sendiri lewat endpoint ini, sesinya sendiri juga berakhir.

Bila tidak ada laboran yang bisa login, pengelola server memakai
`npm run ganti-password` (lihat "Ganti password lewat terminal").

### Profil dan ganti password

Setiap pengguna yang login bisa mengubah nama dan password-nya sendiri. Aplikasi
mobile memakainya untuk mahasiswa (termasuk asisten), web untuk laboran dan
dosen.

```
PUT /auth/me            { fullname }
  -> 200 "Nama berhasil diperbarui"  { id, nim, name, email, role }
PUT /auth/me/password   { oldPassword, password, confirmPassword }
  -> 200 "Password berhasil diganti"  { accessToken, refreshToken }
```

- Hanya nama yang bisa diubah (3–100 karakter, spasi berlebih dirapikan). NIM,
  email, dan role di body diabaikan. Ganti nama tidak mengeluarkan sesi dan
  tidak mengirim event real-time; layar lain melihat nama baru setelah memuat
  ulang.
- Ganti password: 400 "Password lama wajib diisi!", "Password minimal 8
  karakter!", "Konfirmasi password tidak sama!", "Password lama salah!", atau
  "Password baru harus berbeda dari password lama." Penolakan tidak mengubah
  apa pun.
- Setelah berhasil, sesi lama dicabut seperti pada Lupa password (termasuk
  aliran SSE), kode Lupa password yang masih tersimpan dihapus, dan balasannya
  berisi token baru. Perangkat yang mengganti password menyimpan token itu
  sehingga tetap masuk; perangkat lain kembali ke login.

`trn_registrations` dan `trn_password_resets` memakai Row Level Security seperti
tabel lain, sehingga tidak bisa dibaca lewat API publik Supabase; backend tetap
bisa mengaksesnya karena tersambung sebagai `postgres`.

### Pembaruan real-time (SSE)

`GET /events` membuka satu stream Server-Sent Events per pengguna. Web admin
dan aplikasi mobile membukanya sekali setelah login, lalu memuat ulang data
yang sedang tampil setiap kali ada event, sehingga tidak perlu refresh.

| Event | Isi | Dikirim saat | Penerima |
|---|---|---|---|
| `ready` | `{}` | stream baru tersambung | pembuka stream |
| `announcement` | `announcement_id`, `action` (`created`/`updated`/`deleted`) | pengumuman dibuat, diubah, dihapus | semua |
| `subject` | `subject_id` (+ `action: "updated"` saat diubah) | mata kuliah ditambah atau diubah | semua |
| `class` | `class_id` (+ `action`: `created`, `updated`, atau `deleted` saat kelas ditambah, diubah, atau dihapus) | kelas ditambah, diubah, atau dihapus, peserta kelas berubah (pilih kelas, ditetapkan atau dipindah laboran), asisten ditambah atau dihapus, jam sesinya berubah | semua |
| `activation` | `{}` (atau `class_id` saat kelas diubah/dihapus) | mahasiswa mendaftar mata kuliah, status bayar diubah, kelas ditetapkan atau dipindah, mahasiswa memilih kelas, kelas yang diikuti atau dipegang diubah/dihapus | laboran/dosen, dan mahasiswa yang bersangkutan (peserta dan asisten kelas itu) |
| `meeting` | `class_id`, `meeting_id` (+ `action`: `created`, `updated`, atau `deleted` saat pertemuan ditambah, diubah judulnya, atau dihapus) | pertemuan ditambah, diubah judulnya, atau dihapus, sesi presensi dibuka/ditutup | laboran/dosen, asisten dan peserta kelas itu |
| `attendance` | `class_id`, `meeting_id` | presensi masuk lewat scan, diubah manual, atau dihapus | laboran/dosen, asisten kelas itu, dan mahasiswa yang presensinya berubah |
| `session` | `session_id` | jam sesi ditambah, diubah, dinonaktifkan, atau dihapus | semua |
| `ping` | `{}` | setiap 25 detik | semua, untuk menjaga koneksi |

- Event hanya memberi tahu **apa** yang berubah, bukan datanya. Klien memanggil
  ulang endpoint biasa (`GET /announcement`, `/activation`, `/class/me`,
  `/meeting/:classId`, dan seterusnya), jadi aturan akses data tetap sama dan
  mahasiswa tidak pernah menerima data mahasiswa lain.
- Laboran dan dosen menerima semua event. Mahasiswa (termasuk asisten) hanya
  menerima event umum, event miliknya sendiri, event pertemuan kelas yang ia
  ikuti, dan event pertemuan serta presensi kelas yang ia pegang sebagai
  asisten (`publishClassMembersEvent`, `publishClassAssistantsEvent`).
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

### Asisten per kelas

Asisten adalah **mahasiswa biasa** (role `MAHASISWA`) yang ditugaskan laboran
ke kelas tertentu lewat `trn_class_collaborator`; role `ASISTEN` tidak dipakai
lagi dan `POST /user` tidak menerimanya. Seleksi asisten tetap di luar sistem.

- `POST /collaborator { classId, collaborators: [userId] }` hanya untuk
  LABORAN dan menolak dengan pesan jelas bila: akun bukan mahasiswa (400),
  sudah menjadi asisten kelas itu (409), mahasiswa sedang mengikuti praktikum
  mata kuliah yang sama (ada aktivasi, 409), atau jadwalnya bentrok (hari sama
  dan jam tumpang tindih) dengan kelas yang ia ikuti sebagai praktikan maupun
  kelas lain yang ia pegang (409). Pengecekan jadwal ada di
  `src/utils/Schedule/schedule.ts`.
- Aturan yang sama berlaku ke arah sebaliknya
  (`src/utils/AssistantRules/assistant.rules.ts`): asisten tidak bisa
  mendaftar praktikum mata kuliah yang ia pegang (`POST /activation`, 409), dan
  kelas praktikum yang jadwalnya bentrok dengan kelas yang ia pegang ditolak
  saat ia memilih kelas (`POST /class/registration`), saat laboran menetapkan
  kelas ketika mengonfirmasi bayar (`PUT /activation/:id` dengan `classId`),
  dan saat laboran memindah kelasnya (`PUT /activation/:id/class`).
- `DELETE /collaborator/:classId/:userId` menghapus baris (hard delete), jadi
  mahasiswa itu bisa ditambahkan lagi nanti. Data presensi yang pernah ia catat
  tetap ada.
- Pertemuan, QR, buka/tutup sesi, dan ubah/hapus presensi hanya boleh untuk
  LABORAN atau asisten kelas itu (`assertCanManageClass` di
  `src/utils/ClassAccess/class.access.ts`), selain itu 403 "Hanya laboran atau
  asisten kelas ini yang dapat melakukannya!". Sebelumnya setiap akun ASISTEN
  bisa mengatur semua kelas.
- `GET /meeting/:classId`: mahasiswa yang menjadi peserta kelas mendapat
  tampilan pribadi; asisten kelas itu (yang bukan peserta) mendapat tampilan
  staf berisi semua mahasiswa.
- `GET /class` untuk MAHASISWA hanya berisi kelas yang ia pegang. Web memakainya
  untuk halaman Praktikum asisten dan untuk menolak login mahasiswa yang tidak
  memegang kelas; mobile memakainya untuk bagian "Asisten Praktikum" di Profil.

### Akses dosen

Dosen hanya **memantau** mata kuliah yang ia ampu (`mst_subject.lecturer_id`)
dan tidak bisa mengubah data apa pun. Semua endpoint yang mengubah data tetap
menolak dosen seperti sebelumnya.

- Daftar mata kuliah (`GET /subject`) dan kelas (`GET /class`) untuk DOSEN hanya
  berisi miliknya.
- Detail mata kuliah, detail kelas, pertemuan dan presensi
  (`GET /meeting/:classId`), daftar asisten, dan teman sekelas milik dosen lain
  dibalas 403 "Mata kuliah ini bukan yang Anda ampu." atau "Kelas ini bukan mata
  kuliah yang Anda ampu." Id yang tidak ada tetap 404. Pemeriksaannya ada di
  `lecturerSubjectScope`, `assertLecturerOfSubject`, dan `assertLecturerOfClass`
  (`src/utils/ClassAccess/class.access.ts`).
- `GET /activation` (data pembayaran) dibalas 403 "Data pembayaran praktikum
  hanya bisa dilihat laboran!" untuk DOSEN. Sebelumnya dosen bisa membaca status
  bayar semua mahasiswa lewat API.
- `GET /dashboard/dosen` (khusus DOSEN, peran lain 403 "Ringkasan ini hanya
  untuk dosen!") menghitung angka dashboard dari kelas mata kuliah yang ia ampu:

  ```
  { total_class, total_student, total_meeting,
    total_attended, total_expected_attendance, attendance_rate }
  ```

  - `total_student`: peserta kelas, dihitung sekali walau ikut dua mata kuliah
    dosen yang sama.
  - `total_meeting`: semua pertemuan yang sudah dibuat (sama dengan kolom di
    rekap presensi).
  - `total_expected_attendance`: jumlah peserta × jumlah pertemuan per kelas,
    dijumlahkan. `total_attended`: presensi berstatus hadir dari peserta kelas
    itu.
  - `attendance_rate`: `total_attended / total_expected_attendance × 100`
    dibulatkan; `null` bila belum ada pertemuan atau peserta. "Belum presensi"
    dihitung tidak hadir, sama seperti kolom Hadir di rekap.
  - Kelas dan pertemuan yang `deleted_at`-nya terisi tidak dihitung.
- Dosen tetap menerima semua event real-time seperti laboran, sehingga
  dashboard dan halaman kelasnya ikut berubah tanpa refresh.

### Tambah kelas dan jam sesi

Jam kelas tidak lagi diketik bebas. Kelas memilih satu **jam sesi** yang diatur
laboran (tabel `mst_session`, menu web Master Data → Jam Sesi).

- Jam sesi dibagi dua kelompok hari (`day_group`): `WEEKDAY` untuk Senin–Kamis
  dan `FRIDAY` untuk Jumat, karena jam hari Jumat berbeda. Setiap sesi punya
  nomor 1–20 yang unik per kelompok, jam mulai dan selesai berformat `JJ.MM`,
  dan status aktif. Sesi dalam satu kelompok tidak boleh tumpang tindih (yang
  bersambung, misalnya 08.40 dan 08.40, boleh).
- Isi awal: Senin–Kamis Sesi 1–6 (07.00–08.40, 08.45–10.25, 10.30–12.10,
  12.30–14.10, 14.15–16.05, 16.10–17.10), sama dengan daftar yang sebelumnya
  tertulis di kode web. Jam sesi Jumat masih kosong, jadi kelas hari Jumat baru
  bisa dibuat setelah laboran mengisinya.
- `mst_class.sessionId` mencatat sesi kelas, sedangkan `startAt`/`endAt` tetap
  disimpan, sehingga aplikasi mobile dan pengecekan bentrok jadwal asisten tidak
  berubah. Mengubah jam sesi (`PUT /session/:id`) ikut mengubah jam semua kelas
  di sesi itu dalam satu transaksi dan mengirim event `session` serta `class`.
- Sesi yang dipakai kelas tidak bisa dihapus (409 "... dipakai n kelas.
  Nonaktifkan saja ..."); sesi nonaktif tidak muncul di pilihan kelas baru.
- `GET /session` hanya memberi jumlah kelas per sesi. Daftar kelasnya diambil
  dari `GET /class`, yang kini berisi `sessionId`, supaya aturan akses kelas
  tetap di satu tempat (`GET /session` bisa dibaca semua peran).

`POST /class { subjectId, name, quota, day, room, sessionId }` (hanya LABORAN,
selain itu 403) memeriksa, dengan pesan berbahasa Indonesia:

- nama kelas satu huruf A–Z (huruf kecil diubah jadi besar, spasi dibuang),
  kuota 1–99, hari MONDAY–FRIDAY, ruang PSI atau SBTI, dan sesi wajib dipilih
  (400);
- mata kuliah ada (404), sesi ada dan aktif, dan sesi sesuai kelompok hari
  kelas (400 "Sesi 2 bukan sesi hari Jumat!");
- nama kelas belum dipakai di mata kuliah itu (409 "Kelas B sudah ada di
  ...!");
- **ruang tidak bentrok**: satu ruang hanya untuk satu kelas pada hari dan jam
  yang tumpang tindih (409 "Ruang PSI sudah dipakai Algoritma dan Pemrograman
  kelas C (Selasa, 16.10 - 17.10)."). PSI dan SBTI dua ruang terpisah.

Jam kelas diambil dari sesi, dan hanya field di atas yang disimpan (sebelumnya
seluruh body disalin ke database). Balasan 201: "Kelas <mata kuliah> <nama>
berhasil ditambahkan" `{ id }`. Sebelum aturan ini, empat kelas Senin 07.00 dan
dua kelas Selasa 07.00 di PSI saling bentrok; keenamnya sudah dihapus beserta
pertemuan, presensi, dan pesertanya, sedangkan aktivasi mahasiswa tetap ada.

### Ubah dan hapus kelas

Laboran mengubah atau menghapus kelas dari halaman detail kelas di web.

`PUT /class/:id { name?, quota?, day?, room?, sessionId? }` (hanya LABORAN,
selain itu 403 "Hanya laboran yang dapat mengubah kelas!"):

- Field yang tidak dikirim memakai nilai sekarang, lalu hasilnya diperiksa
  dengan aturan yang sama seperti tambah kelas (format, sesi sesuai hari,
  nama belum dipakai kelas lain, ruang tidak bentrok dengan kelas lain).
- Mata kuliah tidak bisa diganti (400 "Mata kuliah kelas tidak bisa
  diubah!"). Kuota tidak boleh di bawah jumlah peserta (409 "Kuota tidak boleh
  kurang dari jumlah peserta (n)!").
- Sesi yang sudah nonaktif tetap boleh dipakai kelas yang memang sudah
  memakainya, jadi kuota atau ruangnya masih bisa diubah. Kelas lain tidak bisa
  pindah ke sesi nonaktif.
- Bila hari atau jam berubah, **jadwal anggota kelas diperiksa** (409 "Jadwal
  baru bentrok: ..."): asisten kelas ini tidak boleh punya kelas lain (sebagai
  praktikan maupun asisten) di jam baru, dan peserta kelas ini tidak boleh
  menjadi asisten kelas lain di jam baru. Aturan ini sama dengan saat asisten
  ditambahkan dan saat mahasiswa memilih kelas
  (`assertNoMemberScheduleClash` di `src/utils/AssistantRules/assistant.rules.ts`).
- Peserta, asisten, pertemuan, dan presensi tetap tersimpan. Jadwal baru
  berlaku untuk pertemuan berikutnya.
- Body yang isinya sama dengan data sekarang dibalas 200 "Tidak ada perubahan
  pada kelas" tanpa menulis ke database dan tanpa event.
- Berhasil: 200 "Kelas <mata kuliah> <nama> berhasil diperbarui", event
  `class` (`action: "updated"`) ke semua dan `activation` ke peserta serta
  asisten kelas itu, supaya jadwal di aplikasi mereka ikut berubah.

`DELETE /class/:id` (hanya LABORAN, selain itu 403 "Hanya laboran yang dapat
menghapus kelas!"):

- Kelas yang sudah punya presensi (ada mahasiswa yang tercatat di salah satu
  pertemuannya) **tidak bisa dihapus**: 409 "Kelas ini sudah punya presensi di
  n pertemuan, jadi tidak bisa dihapus. Ubah kelasnya bila ada data yang
  salah." Presensi adalah catatan resmi, jadi kelas seperti ini tetap ada
  sebagai riwayat.
- Bila belum ada presensi, kelas dihapus permanen dalam satu transaksi beserta
  pertemuan kosongnya, peserta, dan asistennya. Peserta kembali berstatus
  lunas tanpa kelas dan bisa memilih kelas lain; status pembayaran tidak
  berubah. Pertemuan yang dibuat tanpa sengaja karena itu tidak mengunci
  kelas selamanya.
- Bila presensi baru tercatat tepat saat penghapusan berjalan, foreign key
  menolak penghapusan pertemuannya dan balasannya 409 "Presensi baru saja
  tercatat di kelas ini, jadi kelas tidak bisa dihapus."
- Berhasil: 200 "Kelas <mata kuliah> <nama> berhasil dihapus"
  `{ participants, assistants, meetings }`, event `class`
  (`action: "deleted"`) ke semua dan `activation` ke peserta serta asisten.
- `GET /class/:id` kini juga berisi `sessionId`, `meetings` (jumlah
  pertemuan), dan `recorded_meetings` (pertemuan yang sudah berisi presensi),
  sehingga web bisa menampilkan dampak penghapusan sebelum laboran
  mengonfirmasi. Kelas yang tidak ada dibalas 404 "Kelas tidak ditemukan!"
  (sebelumnya "Class not found!").

Karena kelas bisa dipindah ke sesi lain, sesi yang sudah dipakai kelas bisa
dikosongkan dulu lalu dihapus.

### Tambah dan ubah mata kuliah

Laboran menambah mata kuliah di web lewat Master Data → Tambah Mata Kuliah dan
mengubahnya dari tombol "Ubah" di halaman Praktikum. Keduanya memakai aturan
yang sama (`readSubjectFields` dan `assertSubjectUnique` di
`src/services/subject.service.ts`).

`POST /subject { subject_code, subject_name, semester, lecturer_id }` (hanya
LABORAN, selain itu 403 "Hanya laboran yang dapat menambah mata kuliah!"):
semua field wajib dan diperiksa dengan aturan di bawah. Hanya keempat field
itu yang disimpan. Berhasil: 201 "Mata kuliah <nama> berhasil ditambahkan"
`{ id }` dan event `subject` (`action: "created"`). Sebelumnya endpoint ini
membalas dalam bahasa Inggris, menolak non-laboran dengan 401, membiarkan
nama kembar, dan berakhir 500 bila `lecturer_id` salah.

`PUT /subject/:id { subject_code?, subject_name?, semester?, lecturer_id? }`
(hanya LABORAN, selain itu 403 "Hanya laboran yang dapat mengubah mata
kuliah!"):

- Field yang tidak dikirim memakai nilai sekarang. Spasi berlebih dirapikan.
  Kode wajib diisi dan harus tepat 9 angka (400 "Kode mata kuliah harus 9
  angka!"), nama wajib diisi dan paling banyak 100 karakter, semester 1–8 (boleh dikirim sebagai angka), dan
  `lecturer_id` harus akun berperan DOSEN (400 "Dosen pengampu harus akun
  dosen yang terdaftar!").
- Kode dan nama tidak boleh sama dengan mata kuliah lain, tanpa membedakan
  huruf besar-kecil (409 "Kode X sudah dipakai mata kuliah Y!" atau "Nama X
  sudah dipakai mata kuliah berkode Y!"). Nama harus unik karena beberapa
  tampilan lama mengenali mata kuliah dari namanya.
- Isi yang sama dengan data sekarang dibalas 200 "Tidak ada perubahan pada
  mata kuliah" tanpa menulis database.
- Berhasil: 200 "Mata kuliah <nama> berhasil diperbarui", ditambah "; dosen
  pengampu sekarang <nama>" bila dosen diganti. Event `subject`
  (`action: "updated"`) dan `class` untuk tiap kelasnya dikirim ke semua, dan
  `activation` ke mahasiswa yang mengambil mata kuliah itu, supaya nama mata
  kuliah dan nama dosen di aplikasi mereka ikut berubah.

**Kode mata kuliah** adalah kode resmi kurikulum, 9 angka. Aturan ini berlaku
untuk semua mata kuliah, jadi mengubah mata kuliah yang kodenya belum 9 angka
ditolak sampai kodenya diganti. Kode contoh di data uji ("001", "002", "003",
"005") sudah diganti menjadi 553310001, 553310002, 553310003, dan 553310005.
`GET /class/:id` ikut mengirim `subject_code` untuk judul rekap PDF di web.

**Bila dosen pengampu diganti**, akses dosen mengikuti `lecturer_id` saat itu
juga, karena semua pemeriksaan akses dosen membaca kolom itu setiap kali
(`src/utils/ClassAccess/class.access.ts`):

- dosen baru langsung bisa membaca mata kuliah itu beserta semua kelas,
  pertemuan, dan presensinya, termasuk yang tercatat sebelum pergantian, dan
  dashboard-nya ikut menghitungnya;
- dosen lama langsung kehilangan akses (403), termasuk ke riwayat saat ia
  masih mengampu. Riwayat dosen pengampu tidak disimpan (lihat batasan 13).

### Tambah, ubah, hapus, dan urutan pertemuan

`POST /meeting` (LABORAN atau asisten kelas itu) memeriksa, berurutan:

1. `classId` wajib teks: 400 "Kelas wajib diisi!" (sebelumnya `classId`
   kosong atau berupa angka membuat server error 500).
2. Kelas harus ada: 404 "Kelas tidak ditemukan!".
3. Hak akses: 403 "Hanya laboran atau asisten kelas ini yang dapat
   melakukannya!". Diperiksa sebelum judul, jadi yang tidak berhak tidak
   mendapat petunjuk soal isi kelas.
4. Judul dirapikan (spasi di awal/akhir dibuang, spasi ganda jadi satu) dan
   huruf pertamanya dijadikan kapital, lalu wajib ada dan paling banyak 50
   karakter: 400 "Judul pertemuan wajib diisi!"
   / "Judul pertemuan paling banyak 50 karakter!". Sebelumnya judul kosong
   tetap tersimpan bila dikirim langsung ke API.
5. Judul tidak boleh sama dengan pertemuan lain di kelas yang sama, tanpa
   membedakan huruf besar-kecil dan spasi: 409 "Pertemuan 1 sudah ada di kelas
   ini!" (memakai judul yang sudah tersimpan). Kelas lain boleh memakai judul
   yang sama.

Berhasil: 201 "Pertemuan 3 berhasil ditambahkan" dengan `data: { id }`.
Hanya huruf pertama yang dijadikan kapital, sisanya disimpan sesuai ketikan:
"pertemuan 1" menjadi "Pertemuan 1", "uts" menjadi "Uts", "UTS" tetap "UTS",
dan judul berawalan angka tidak berubah. Judul lama yang berhuruf kecil
("pertemuan 1", "pertemuan 3", dan "asbduad" di Data Mining A) sudah
diperbarui sekali lewat skrip.

Pemeriksaan kembar dan penyimpanan berjalan dalam satu transaksi yang lebih
dulu mengambil `pg_advisory_xact_lock(hashtext(classId))`. Penambahan
pertemuan di kelas yang sama jadi antre satu per satu, sehingga laboran dan
asisten yang menyimpan judul sama pada saat bersamaan tidak bisa sama-sama
lolos (diuji dengan lima permintaan sekaligus: satu 201, empat 409). Tidak ada
constraint database untuk ini, karena unique index pada `lower(name)` butuh
migrasi SQL manual.

`PUT /meeting/:id` mengubah judul dengan aturan yang sama (404 "Pertemuan
tidak ditemukan!", 403, 400, dan 409 kembar; pertemuan itu sendiri tidak
dihitung kembar, jadi "Uts" boleh diubah menjadi "UTS"). Judul yang sama
setelah dirapikan dan dikapitalkan dibalas 200 "Tidak ada perubahan pada
pertemuan" tanpa event. Pertemuan yang sudah punya presensi atau sesinya
sedang dibuka tetap boleh diubah judulnya, karena presensinya tidak
tersentuh. Berhasil: 200 "Pertemuan 2 berhasil diubah menjadi Responsi".

`DELETE /meeting/:id` menghapus permanen (bukan `deleted_at`), dengan
penolakan:

- 409 "Sesi presensi pertemuan ini sedang dibuka. Tutup sesinya dulu sebelum
  menghapus." Mahasiswa mungkin sedang memindai QR.
- 409 "Pertemuan ini sudah punya n presensi, jadi tidak bisa dihapus. Hapus
  presensinya dulu atau ubah judulnya." Catatan "tidak hadir" juga dihitung.
  Presensi bisa dihapus satu per satu lewat
  `DELETE /meeting/:id/attendances/:userId`.

Penghapusan memakai `deleteMany` dengan syarat sesi masih tertutup, jadi sesi
yang baru saja dibuka di antara pemeriksaan dan penghapusan tetap menolak.
Presensi yang tercatat pada saat yang sama ditolak foreign key (Prisma P2003)
dan dibalas 409 "Presensi baru saja tercatat di pertemuan ini, jadi tidak
bisa dihapus." Berhasil: 200 "Pertemuan 2 berhasil dihapus". Judulnya bisa
dipakai lagi setelah itu.

`GET /meeting/:classId` kini diurutkan menurut judul yang dirapikan dengan
`Intl.Collator("id", { numeric: true, sensitivity: "base" })`: angka dibaca
sebagai angka (Pertemuan 2 sebelum Pertemuan 10) dan huruf besar-kecil
diabaikan, lalu menurut waktu dibuat bila judulnya sama. Sebelumnya diurutkan
menurut waktu dibuat saja. Urutan ini dipakai dropdown dan kolom rekap di web
(naik); aplikasi mobile membaliknya, jadi di sana nomor terbesar di atas.

### Aturan lain yang sudah diberlakukan

- **Pindah kelas ditolak** bila mahasiswa sudah punya catatan presensi di kelas
  lama. Laboran harus menghapus presensinya dulu lewat
  `DELETE /meeting/:id/attendances/:userId`.
- **Hapus pengumuman bersifat soft delete** — `deleted_at` diisi, baris tetap ada.
- **Error tak terduga tidak lagi dibocorkan.** Error di luar kelas error
  aplikasi (misalnya error Prisma) dibalas 500 "Terjadi kesalahan pada
  server." dan detailnya dicetak di terminal backend. Sebelumnya pesan mentah
  Prisma, termasuk path file di server, dikirim ke klien. Body JSON yang rusak
  dibalas 400 "Format JSON tidak valid!" (`src/middleware/error.middleware.ts`).

## Bahasa pesan

Semua pesan dari backend berbahasa Indonesia. Satu-satunya pengecualian adalah
**`jwt expired`**, yang sengaja tidak diterjemahkan karena web dan mobile
mencocokkan teks persis itu untuk memperbarui token (lihat Sesi login dan
refresh token).

Pesan yang dulu masih berbahasa Inggris:

| Dulu | Sekarang |
|---|---|
| Login Successful | Login berhasil |
| Success, Success get user data! | Berhasil |
| Announcement not found! | Pengumuman tidak ditemukan! |
| Subject not found! | Mata kuliah tidak ditemukan! |
| User not allowed! | Anda tidak memiliki akses! |
| Unauthorize! (request tanpa header `Authorization`) | Silakan login terlebih dahulu! |
| jwt malformed, invalid signature, dan error token lain | Token tidak valid, silakan login ulang! |

Semua balasan middleware token tetap berstatus 400 seperti sebelumnya. Pesan
bawaan kelas error di `src/utils/HttpErrors` juga diterjemahkan, walaupun saat
ini setiap error selalu membawa pesannya sendiri.

## Akun uji

Pola password: nama awal akun dalam huruf kecil. Laboran dan dosen memakai NIY
8 angka (sebelumnya 2000016002, 2000016001, dan 2000016201).

| NIM / NIY | Password | Role |
|---|---|---|
| 60010002 | laboran002 | LABORAN (nama tampilan kini "akun test") |
| 60010001 | laboran001 | LABORAN |
| 60020001 | dosen001 | DOSEN (mengampu keempat mata kuliah) |
| 2000016099 | mahasiswa001 | MAHASISWA |
| 2000016100 | mahasiswa002 | MAHASISWA (peserta Alpro D) |
| 2000016104 | mahasiswa004 | MAHASISWA (peserta Alpro C dan Data Mining A) |
| 2000016105 | mahasiswa005 | MAHASISWA (asisten Alpro C) |

Akun asisten001 (2000016101) sudah dihapus; Mahasiswa005 menggantikannya
sebagai akun asisten di Postman.

Data uji: kelas `2e32063e-fa79-478c-9b66-4f071d25cca5` (Algoritma dan
Pemrograman, kelas C), pertemuan `9d68f112-6b59-4d4f-9cfe-e3ca46a0be40`
(Pertemuan 1 kelas C).

### Menghapus akun mahasiswa uji

Untuk mengulang uji pendaftaran dengan akun yang sama:

```bash
npm run hapus-akun 2000016123
npm run hapus-akun nama2000016123@webmail.uad.ac.id
```

Script `src/scripts/delete-student.ts` menampilkan ringkasan akun beserta
aktivasi, kelas, riwayat presensi, dan kelas yang dipegang sebagai asisten,
lalu baru menghapus setelah diketik `HAPUS` (huruf besar). Semua data itu
dihapus dalam satu transaksi, jadi jika gagal tidak ada yang berubah.

- Hanya untuk akun MAHASISWA. Akun LABORAN dan DOSEN ditolak.
- Mahasiswa yang masih tercatat di mata kuliah (sebagai dosen, pembuat, atau
  pengubah) atau sebagai penulis pengumuman juga ditolak sampai data itu
  dipindah ke akun lain.
- Jika NIM atau email hanya ada di pendaftaran yang belum diverifikasi,
  pendaftaran itu yang ditawarkan untuk dihapus.
- Permintaan reset password akun itu ikut terhapus otomatis.
- Script berjalan di luar server, jadi tidak mengirim pembaruan real-time.
  Layar yang sedang terbuka baru berubah setelah di-refresh. Aplikasi yang
  masih login dengan akun itu kembali ke halaman login pada permintaan
  berikutnya.
- Database-nya satu-satunya database SILAB di Supabase. Penghapusan permanen.

### Ganti password lewat terminal

Jalan darurat bila akun tidak bisa dipulihkan lewat aplikasi, misalnya semua
laboran lupa password. Hanya bisa dijalankan oleh pengelola server yang
memegang folder backend dan `.env`; tidak ada di web maupun aplikasi mobile.

```bash
npm run ganti-password 60010002
```

```
Akun: akun test (LABORAN, 60010002)
Password baru: ********
Ulangi password baru: ********
Ganti password akun ini? (ya/tidak): ya
Password akun test berhasil diganti. Semua sesi login akun ini diakhiri.
```

- Berlaku untuk semua akun. Laboran dan dosen dikonfirmasi dengan `ya`.
- Untuk mahasiswa, script menampilkan "ALERT: mahasiswa biasanya memakai Lupa
  password lewat email. Pakai skrip ini kalau mahasiswa tidak bisa mengakses
  email kampusnya." dan meminta NIM diketik ulang sebagai konfirmasi.
- Password diketik saat diminta dan tampil sebagai bintang, bukan ditulis di
  perintah, jadi tidak tersimpan di riwayat terminal. Minimal 8 karakter dan
  harus diulang sama persis. Ctrl+C membatalkan tanpa mengubah apa pun.
- Password disimpan sebagai hash bcrypt dan `password_changed_at` diisi,
  sama seperti `PUT /user/:niyAtauId/password`, jadi access token lama dibalas
  `jwt expired` dan refresh token lama 401. Karena script berjalan di luar
  proses server, koneksi SSE yang sedang terbuka tidak diputus saat itu juga;
  perangkat itu kembali ke login pada permintaan berikutnya, paling lambat saat
  access token-nya habis (15 menit).
- Siapa pun yang memegang akses database memang bisa mengubah password
  langsung di sana. Script ini tidak menambah hak baru, hanya memastikan
  caranya aman: di-hash, sesi lama diakhiri, dan ada konfirmasi.
- Kode: `src/scripts/change-password.ts`.

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
5. **Bentrok jadwal hanya diperiksa terhadap kelas yang dipegang sebagai
   asisten.** Dua kelas praktikum milik satu mahasiswa boleh berjadwal sama,
   baik saat memilih kelas maupun saat laboran mengubah jadwal kelas. Jadwal
   yang diubah langsung di database juga tidak diperiksa ulang.
6. **QR yang berganti hanya menghentikan titip absen tertunda** (lewat foto).
   Siaran langsung, misalnya teman di kelas melakukan video call lalu
   mahasiswa yang absen memindai dari layar saat itu juga, tetap bisa lolos.
7. **Titip akun tidak tercegah.** Mahasiswa yang absen bisa memberikan NIM dan
   password ke teman yang hadir, lalu teman itu memindai dari HP-nya sendiri.
   Penangkalnya adalah membatasi satu perangkat untuk satu akun per pertemuan,
   yang butuh perubahan di aplikasi mobile.
8. **Sesi tidak bisa dicabut satu per satu.** Token tidak disimpan di
   database, jadi Keluar hanya menghapusnya dari perangkat. Pencabutan hanya
   bisa sekaligus untuk semua perangkat, yaitu dengan mengganti password.
   Mencabut satu perangkat saja butuh tabel sesi.
9. **Pembaruan real-time hanya untuk satu proses server.** Pendengar SSE
   disimpan di memori, jadi bila backend dijalankan lebih dari satu instance,
   event dari satu instance tidak sampai ke klien yang tersambung ke instance
   lain. Hosting serverless yang memutus koneksi panjang juga tidak cocok.
   Pemutusan SSE saat password diganti juga hanya berlaku di instance yang
   memprosesnya (instance lain baru menolak sesi itu saat klien tersambung
   ulang). Solusinya Redis pub/sub atau `LISTEN/NOTIFY` Postgres di antara
   instance.

10. **"Pertemuan yang sudah berjalan" dihitung dari pertemuan yang sudah
    dibuat.** Tidak ada catatan kapan sesi presensi pertama kali dibuka, jadi
    pertemuan yang dibuat asisten sebelum hari praktikum ikut terhitung di
    dashboard dosen dan menurunkan rata-rata kehadiran. Solusinya menambah
    kolom waktu pertama kali sesi dibuka.

11. **Jam kelas tidak punya riwayat.** Mengubah jam sesi langsung mengubah jam
    semua kelasnya, dan mengubah jadwal satu kelas juga menimpa jadwal
    lamanya, termasuk untuk pertemuan yang sudah lewat. Tidak ada catatan jam
    lama.

12. **Hapus kelas bersifat permanen.** Kelas tanpa presensi dihapus dari
    database (bukan soft delete) dan tidak bisa dipulihkan. Kelas yang sudah
    punya presensi tidak bisa dihapus sama sekali, jadi kelas yang dibubarkan
    di tengah semester tetap tampil. Mengarsipkan kelas butuh pemeriksaan
    `deleted_at` di semua query yang membaca kelas, pertemuan, dan presensi.

13. **Riwayat dosen pengampu tidak disimpan.** `mst_subject.lecturer_id` hanya
    menyimpan dosen saat ini. Bila dosen diganti di tengah semester, dosen
    baru melihat seluruh data sejak awal dan dosen lama kehilangan akses ke
    data saat ia mengampu. Menyimpan riwayat butuh tabel dosen per periode,
    yang bergantung pada batasan 1 (belum ada periode akademik).

## Pekerjaan yang masih tersisa

- [ ] Pastikan jam sesi Senin–Kamis dan isi jam sesi Jumat lewat web
      (Master Data → Jam Sesi)

## Catatan lain

- CORS terbuka untuk semua origin (`app.use(cors())`)
