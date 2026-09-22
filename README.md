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

File `.env` di root (tidak di-commit):

```
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...pooler.supabase.com:5432/postgres"
JWT_SECRET=...
JWT_REFRESH_SECRET=...
```

`DATABASE_URL` dan `DIRECT_URL` dibaca Prisma lewat `schema.prisma`, bukan oleh
kode aplikasi. `src/app.ts` memanggil `dotenv.config()` di baris paling atas —
ini wajib, karena `client.prisma.ts` membuat `PrismaClient` saat modulnya
di-import.

Hanya `JWT_SECRET` dan `JWT_REFRESH_SECRET` yang dibaca langsung oleh kode.

## Sejarah proyek

Tiga generasi kode:

1. **Backend MongoDB** (Sep 2024) — Express 4, Mongoose. Repo terpisah, tidak dipakai.
2. **Backend di IP kampus** `10.4.52.201:3001` — **repo hilang, server mati**.
   Dulu melayani aplikasi mobile Flutter dan folder `app/actions/` di frontend
   web. Endpointnya berbentuk jamak (`/announcements`, `/registrations`).
3. **Backend ini** (Mei 2025–sekarang) — dibangun ulang dari nol karena
   generasi 2 hilang. Endpoint berbentuk tunggal.

Aplikasi mobile Flutter (`silab-mobile`) masih menunjuk ke generasi 2 yang sudah
mati, jadi saat ini tidak berfungsi.

## Alur bisnis

1. Laboran membuat mata kuliah (`POST /subject`) dan kelas (`POST /class`)
2. Mahasiswa mendaftar mata kuliah (`POST /activation`) → status `false`
3. Pembayaran **offline**; laboran menandai lunas (`PUT /activation/:id`)
   dan sekaligus memilih kelas lewat `classId` di body
4. Asisten/laboran membuat pertemuan (`POST /meeting`) — token 6 karakter
   digenerate otomatis
5. Asisten/laboran membuka sesi presensi (`PUT /meeting/:id/status`)
6. Mahasiswa scan QR berisi token → presensi tercatat

Jalur alternatif (dipakai aplikasi mobile): setelah lunas, mahasiswa memilih
kelasnya sendiri lewat `GET /class/registration` → `POST /class/registration`.
Jalur ini tetap ada dan tidak dihapus.

Catatan: `trn_activations` hanya menyimpan `subjectId`, **bukan** `classId`.

## Daftar endpoint

| Method | Path | Role |
|---|---|---|
| POST | `/auth/login` | publik |
| POST | `/auth/register` | publik |
| GET | `/auth/me` | login |
| POST | `/subject` | LABORAN |
| GET | `/subject` | login |
| GET | `/subject/:id` | login |
| POST | `/class` | LABORAN |
| GET | `/class` | login |
| GET | `/class/registration` | MAHASISWA |
| POST | `/class/registration` | MAHASISWA |
| GET | `/class/:id` | login |
| POST | `/activation` | MAHASISWA |
| GET | `/activation?status=&name=` | login |
| PUT | `/activation/:id` | LABORAN |
| PUT | `/activation/:id/class` | LABORAN |
| POST | `/meeting` | ASISTEN, LABORAN |
| GET | `/meeting/:classId` | login |
| PUT | `/meeting/:id/status` | ASISTEN, LABORAN |
| PUT | `/meeting/:id/attendances/:userId` | ASISTEN, LABORAN |
| DELETE | `/meeting/:id/attendances/:userId` | ASISTEN, LABORAN |
| POST | `/subject/classes/:classId/meetings/:meetingId/attendances` | MAHASISWA |
| GET | `/user/dosen` | login |
| GET | `/user/asisten?name=` | login |
| POST | `/announcement` | LABORAN |
| GET | `/announcement` | login |
| GET | `/announcement/:id` | login |
| PUT | `/announcement/:id` | LABORAN |
| DELETE | `/announcement/:id` | LABORAN |
| POST | `/collaborator` | **tanpa batas role** |
| GET | `/collaborator/:id` | login |

### Endpoint presensi (inti skripsi)

```
POST /subject/classes/:classId/meetings/:meetingId/attendances
Authorization: Bearer <token mahasiswa>
Body: { "token": "S8Bxpm" }
→ 201
```

Jalur ini sengaja dibuat identik dengan yang dipanggil aplikasi Flutter
(`classes_api_service.dart`, fungsi `addUserAttendance`), supaya mobile
berpeluang tersambung kembali cukup dengan mengubah `baseUrl` di `main.dart`.

Urutan validasi: token wajib ada → role MAHASISWA → pertemuan milik kelas itu →
sesi sedang dibuka → token cocok → mahasiswa peserta kelas → belum pernah
presensi.

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

## Bahasa pesan

Tiga service sudah berbahasa Indonesia: `activation`, `attendance`, `meeting`,
dan sebagian `announcement`.

Belum: `auth`, `subject`, `class`, `user`, `collaborator`. Jadi login masih
menjawab "Login Successful".

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

## Pekerjaan yang masih tersisa

- [ ] Batasi role pada `POST /collaborator`
- [ ] Seragamkan pesan lima service sisanya ke bahasa Indonesia
- [ ] Endpoint yang dibutuhkan mobile tapi belum ada: `GET /registrations/me`,
      `GET /users/schedules/me`
- [ ] Verifikasi bentuk JSON respons terhadap entity `freezed` di Flutter
      sebelum mencoba menyambungkan mobile
- [ ] Frontend: halaman Rekap PDF masih bermasalah (lihat README frontend)

## Catatan lain

- CORS terbuka untuk semua origin (`app.use(cors())`)
- `POST /auth/register` terbuka tanpa autentikasi dan bisa menentukan `role`
  sendiri lewat body
