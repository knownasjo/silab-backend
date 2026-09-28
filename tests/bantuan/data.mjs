import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(`${ROOT}package.json`);
require("dotenv").config({ path: `${ROOT}.env`, quiet: true });

if (process.env.NODE_ENV === "production" && process.env.IZINKAN_UJI !== "ya") {
  console.error(
    "Tes dihentikan: NODE_ENV=production, jadi .env ini kemungkinan menunjuk database asli.\n" +
      "Tes membuat lalu menghapus akun dan data uji. Bila memang disengaja, jalankan ulang dengan IZINKAN_UJI=ya."
  );
  process.exit(1);
}

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

export const jwt = require("jsonwebtoken");
export const db = new PrismaClient();

export const TEST_NIM_PREFIX = "29999";
export const TEST_CODE_PREFIX = "999";
export const TEST_SESSION_FROM = 9000;
export const MISSING_ID = "00000000-0000-4000-8000-000000000000";

const SESSION_TIMES = [
  ["18.00", "18.40"],
  ["18.45", "19.25"],
  ["19.30", "20.10"],
  ["20.15", "20.55"],
  ["21.00", "21.40"],
  ["21.45", "22.25"],
];

const notTestUser = { nim: { not: { startsWith: TEST_NIM_PREFIX } } };
const notTestSubject = {
  subject_code: { not: { startsWith: TEST_CODE_PREFIX } },
};

const realDataQueries = {
  mst_user: () =>
    db.mst_user.findMany({ where: notTestUser, orderBy: { id: "asc" } }),
  mst_subject: () =>
    db.mst_subject.findMany({ where: notTestSubject, orderBy: { id: "asc" } }),
  mst_class: () =>
    db.mst_class.findMany({
      where: { subject: notTestSubject },
      orderBy: { id: "asc" },
    }),
  mst_session: () =>
    db.mst_session.findMany({
      where: { number: { lt: TEST_SESSION_FROM } },
      orderBy: { id: "asc" },
    }),
  trn_activations: () =>
    db.trn_activations.findMany({
      where: { user: notTestUser },
      orderBy: { id: "asc" },
    }),
  trn_class_participants: () =>
    db.trn_class_participants.findMany({
      where: { user: notTestUser },
      orderBy: [{ classId: "asc" }, { userId: "asc" }],
    }),
  trn_meetings: () =>
    db.trn_meetings.findMany({
      where: { class: { subject: notTestSubject } },
      orderBy: { id: "asc" },
    }),
  trn_meeting_participants: () =>
    db.trn_meeting_participants.findMany({
      where: { user: notTestUser },
      orderBy: [{ meetingId: "asc" }, { userId: "asc" }],
    }),
  trn_class_collaborator: () =>
    db.trn_class_collaborator.findMany({
      where: { user: notTestUser },
      orderBy: { id: "asc" },
    }),
  mst_announcement: () =>
    db.mst_announcement.findMany({
      where: { announcementAuthor: notTestUser },
      orderBy: { id: "asc" },
    }),
  mst_academic_period: () =>
    db.mst_academic_period.findMany({ orderBy: { id: "asc" } }),
};

export const findActivePeriod = () =>
  db.mst_academic_period.findFirst({
    orderBy: [{ year: "desc" }, { term: "desc" }],
  });

export const retry = async (work, attempts = 5) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};

export const snapshotRealData = () =>
  retry(async () => {
    const entries = await Promise.all(
      Object.entries(realDataQueries).map(async ([table, query]) => [
        table,
        createHash("sha1")
          .update(JSON.stringify(await query()))
          .digest("hex"),
      ])
    );
    return Object.fromEntries(entries);
  });

export const changedTables = (before, after) =>
  Object.keys(before).filter((table) => before[table] !== after[table]);

const countTestData = (nimPrefix, codePrefix, sessionFrom, sessionTo) =>
  retry(async () => {
    const counts = await Promise.all([
      db.mst_user.count({ where: { nim: { startsWith: nimPrefix } } }),
      db.mst_subject.count({
        where: { subject_code: { startsWith: codePrefix } },
      }),
      db.mst_session.count({
        where: { number: { gte: sessionFrom, lte: sessionTo } },
      }),
      db.trn_registrations.count({ where: { nim: { startsWith: nimPrefix } } }),
    ]);
    return counts.reduce((sum, count) => sum + count, 0);
  });

export const countAllTestData = () =>
  countTestData(TEST_NIM_PREFIX, TEST_CODE_PREFIX, TEST_SESSION_FROM, 99999);

export class TestData {
  constructor(block) {
    if (!/^\d{2}$/.test(block))
      throw new Error("Blok data uji harus 2 angka, misalnya 11");
    this.block = block;
    this.nimPrefix = `${TEST_NIM_PREFIX}${block}`;
    this.codePrefix = `${TEST_CODE_PREFIX}${block}`;
    this.sessionFrom = TEST_SESSION_FROM + Number(block) * 10;
    this.password = randomBytes(9).toString("base64url");
    this.counter = { user: 0, subject: 0 };
  }

  async start() {
    await this.cleanup();
    this.passwordHash = await bcrypt.hash(this.password, 4);
    this.laboran = await this.user("LABORAN", "Laboran Uji");
    this.lecturer = await this.user("DOSEN", "Dosen Uji");
    this.period = await findActivePeriod();
    if (!this.period)
      throw new Error(
        "Belum ada periode akademik di database. Mulai semester dulu lewat POST /period."
      );
    return this;
  }

  nextNim() {
    this.counter.user += 1;
    return `${this.nimPrefix}${String(this.counter.user).padStart(3, "0")}`;
  }

  nextCode() {
    this.counter.subject += 1;
    return `${this.codePrefix}${String(this.counter.subject).padStart(4, "0")}`;
  }

  async user(role, fullname) {
    const nim = this.nextNim();
    return db.mst_user.create({
      data: {
        fullname: fullname ?? `Mahasiswa Uji ${nim.slice(-3)}`,
        nim,
        email: `uji-${nim}@example.test`,
        password: this.passwordHash,
        role,
      },
    });
  }

  student(fullname) {
    return this.user("MAHASISWA", fullname);
  }

  async students(count, name = (i) => undefined) {
    const nims = Array.from({ length: count }, () => this.nextNim());
    await db.mst_user.createMany({
      data: nims.map((nim, i) => ({
        fullname: name(i) ?? `Mahasiswa Uji ${nim.slice(-3)}`,
        nim,
        email: `uji-${nim}@example.test`,
        password: this.passwordHash,
        role: "MAHASISWA",
      })),
    });
    return db.mst_user.findMany({
      where: { nim: { in: nims } },
      orderBy: { nim: "asc" },
    });
  }

  subject(subject_name, { semester = "3", subject_code } = {}) {
    return db.mst_subject.create({
      data: {
        subject_code: subject_code ?? this.nextCode(),
        subject_name,
        semester,
        lecturer_id: this.lecturer.id,
        created_by: this.laboran.id,
      },
    });
  }

  async sessions() {
    if (!this.sessionList) {
      this.sessionList = [];
      for (const [index, [startAt, endAt]] of SESSION_TIMES.entries()) {
        this.sessionList.push(
          await db.mst_session.create({
            data: {
              day_group: "WEEKDAY",
              number: this.sessionFrom + index + 1,
              startAt,
              endAt,
              created_by: this.laboran.id,
            },
          })
        );
      }
    }
    return this.sessionList;
  }

  async classOf(
    subject,
    name,
    day,
    sessionNumber,
    { room = "PSI", quota = 30, period = this.period } = {}
  ) {
    const session = (await this.sessions())[sessionNumber - 1];
    return db.mst_class.create({
      data: {
        subjectId: subject.id,
        periodId: period.id,
        name,
        quota,
        day,
        room,
        sessionId: session.id,
        startAt: session.startAt,
        endAt: session.endAt,
        created_by: this.laboran.id,
      },
    });
  }

  activate(user, subject, status, period = this.period) {
    return db.trn_activations.create({
      data: {
        userId: user.id,
        subjectId: subject.id,
        periodId: period.id,
        status,
      },
    });
  }

  enroll(user, cls) {
    return db.trn_class_participants.create({
      data: { userId: user.id, classId: cls.id },
    });
  }

  meeting(cls, name, { status = false } = {}) {
    return db.trn_meetings.create({
      data: {
        classId: cls.id,
        name,
        token: randomBytes(3).toString("hex").toUpperCase(),
        status,
      },
    });
  }

  attend(meeting, user, status = true) {
    return db.trn_meeting_participants.create({
      data: { meetingId: meeting.id, userId: user.id, status },
    });
  }

  async cleanup() {
    const sessionTo = this.sessionFrom + 9;
    await retry(async () => {
      const users = (
        await db.mst_user.findMany({
          where: { nim: { startsWith: this.nimPrefix } },
          select: { id: true },
        })
      ).map((user) => user.id);
      const subjects = (
        await db.mst_subject.findMany({
          where: {
            OR: [
              { subject_code: { startsWith: this.codePrefix } },
              { created_by: { in: users } },
              { lecturer_id: { in: users } },
            ],
          },
          select: { id: true },
        })
      ).map((subject) => subject.id);
      const classes = (
        await db.mst_class.findMany({
          where: {
            OR: [
              { subjectId: { in: subjects } },
              { created_by: { in: users } },
            ],
          },
          select: { id: true },
        })
      ).map((cls) => cls.id);
      const meetings = { classId: { in: classes } };

      await db.trn_meeting_participants.deleteMany({
        where: { OR: [{ meeting: meetings }, { userId: { in: users } }] },
      });
      await db.trn_meetings.deleteMany({ where: meetings });
      await db.trn_class_collaborator.deleteMany({
        where: {
          OR: [{ classId: { in: classes } }, { userId: { in: users } }],
        },
      });
      await db.trn_class_participants.deleteMany({
        where: {
          OR: [{ classId: { in: classes } }, { userId: { in: users } }],
        },
      });
      await db.trn_activations.deleteMany({
        where: {
          OR: [{ subjectId: { in: subjects } }, { userId: { in: users } }],
        },
      });
      await db.mst_class.deleteMany({ where: { id: { in: classes } } });
      await db.mst_academic_period.deleteMany({
        where: { created_by: { in: users } },
      });
      await db.mst_subject.deleteMany({ where: { id: { in: subjects } } });
      await db.mst_session.deleteMany({
        where: {
          OR: [
            { number: { gte: this.sessionFrom, lte: sessionTo } },
            { created_by: { in: users } },
          ],
        },
      });
      await db.mst_announcement.deleteMany({
        where: { author: { in: users } },
      });
      await db.trn_password_resets.deleteMany({
        where: { userId: { in: users } },
      });
      await db.trn_registrations.deleteMany({
        where: { nim: { startsWith: this.nimPrefix } },
      });
      await db.mst_user.deleteMany({ where: { id: { in: users } } });
    });
    this.sessionList = undefined;
    return countTestData(
      this.nimPrefix,
      this.codePrefix,
      this.sessionFrom,
      sessionTo
    );
  }
}
