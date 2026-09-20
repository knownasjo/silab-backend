# SILAB Backend

API untuk SILAB — sistem pengelolaan praktikum laboratorium Program Studi
Sistem Informasi, Universitas Ahmad Dahlan. Ini adalah proyek skripsi dengan
fokus utama pada **presensi mahasiswa berbasis QR code**.

## Stack

- Express 5 + TypeScript
- Prisma 6 (schema di `src/prisma/schema.prisma`)
- PostgreSQL di Supabase
- JWT (accessToken 15 menit, refreshToken 24 jam)
- bcryptjs, 10 salt rounds

## Menjalankan

```bash
npm install
npm run dev        # nodemon + ts-node, port 3000
```

Butuh Node.js 22 LTS. **Node 24+ tidak bisa** — dependensi
`buffer-equal-constant-time` memakai `SlowBuffer` yang sudah dihapus dari Node.

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

## Sejarah proyek — penting untuk dipahami

Ada tiga generasi kode dalam proyek ini:

1. **Backend MongoDB** (Sep 2024) — Express 4, Mongoose, JavaScript.
   Repo terpisah. Sudah tidak dipakai.
2. **Backend di IP kampus** `10.4.52.201:3001` (2024–2025) — **repo hilang,
   server mati**. Inilah yang dulu melayani aplikasi mobile Flutter dan folder
   `app/actions/` di frontend web. Endpoint-nya berbentuk jamak
   (`/announcements`, `/activations`, `/registrations`).
3. **Backend ini** (Mei 2025–sekarang) — Prisma + Supabase, dibangun ulang
   dari nol karena generasi 2 hilang. Endpoint berbentuk tunggal
   (`/announcement`, `/activation`, `/class`).

Aplikasi mobile Flutter (repo `silab-mobile`) masih menunjuk ke generasi 2 yang
sudah mati, jadi saat ini tidak berfungsi.

## Alur bisnis

1. Laboran membuat mata kuliah (`POST /subject`) dan kelas praktikum
   (`POST /class`)
2. Mahasiswa mendaftar mata kuliah (`POST /activation`) → status `false`
3. Pembayaran dilakukan **offline**; laboran menandai lunas
   (`PUT /activation/:id`) → status `true`
4. Setelah lunas, mahasiswa memilih kelas (`GET /class/registration` →
   `POST /class/registration`)
5. Asisten/laboran membuat pertemuan (`POST /meeting`) — token 6 karakter
   digenerate otomatis
6. Asisten/laboran membuka sesi presensi (`PUT /meeting/:id/status`)
7. Mahasiswa scan QR berisi token → presensi tercatat

Catatan: `trn_activations` hanya menyimpan `subjectId`, **bukan** `classId`.
Jadi pembayaran berfungsi sebagai gerbang izin, bukan pemicu otomatis masuk
kelas.

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
| POST | `/meeting` | ASISTEN, LABORAN |
| GET | `/meeting/:classId` | login |
| PUT | `/meeting/:id/status` | ASISTEN, LABORAN |
| POST | `/subject/classes/:classId/meetings/:meetingId/attendances` | MAHASISWA |
| GET | `/user/dosen` | login |
| GET | `/user/asisten?name=` | login |
| POST | `/announcement` | **tanpa batas role** |
| GET | `/announcement` | login |
| GET | `/announcement/:id` | login |
| POST | `/collaborator` | **tanpa batas role** |
| GET | `/collaborator/:id` | login |

### Endpoint presensi

```
POST /subject/classes/:classId/meetings/:meetingId/attendances
Authorization: Bearer <token mahasiswa>
Body: { "token": "S8Bxpm" }
→ 201
```

Jalur ini sengaja dibuat identik dengan yang dipanggil aplikasi Flutter
(`classes_api_service.dart`, fungsi `addUserAttendance`), supaya mobile
berpeluang tersambung kembali cukup dengan mengubah `baseUrl` di `main.dart`.

Urutan validasinya: token wajib ada → role MAHASISWA → pertemuan milik kelas
itu → sesi sedang dibuka → token cocok → mahasiswa peserta kelas → belum
pernah presensi.

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

## Pekerjaan yang masih tersisa

- [ ] Endpoint presensi manual oleh laboran/asisten (ubah kehadiran tanpa scan)
- [ ] `PUT /activation/:id` menerima `classId` agar laboran sekaligus
      memasukkan mahasiswa ke kelas saat menandai lunas
- [ ] Batasi role pada `POST /announcement` dan `POST /collaborator`
- [ ] Endpoint yang dibutuhkan mobile tapi belum ada: `GET /registrations/me`,
      `GET /users/schedules/me`
- [ ] Verifikasi bentuk JSON respons terhadap entity `freezed` di aplikasi
      Flutter sebelum mencoba menyambungkan mobile
- [ ] Frontend: tombol buka presensi, QR code, dan edit kehadiran manual
      belum tersambung

## Catatan lain

- CORS saat ini terbuka untuk semua origin (`app.use(cors())`)
- `POST /auth/register` terbuka tanpa autentikasi dan bisa menentukan `role`
  sendiri lewat body
