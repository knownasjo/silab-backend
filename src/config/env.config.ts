const qrPeriodSeconds = Number(process.env.QR_TOKEN_PERIOD_SECONDS);
const smtpPort = Number(process.env.SMTP_PORT);

export const env = {
  IS_PRODUCTION: process.env.NODE_ENV === "production",
  JWT: {
    SECRET: process.env.JWT_SECRET || "jwt-secret",
    REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "jwt-refresh-secret",
  },
  QR: {
    PERIOD_SECONDS: qrPeriodSeconds > 0 ? qrPeriodSeconds : 10,
  },
  MAIL: {
    HOST: process.env.SMTP_HOST || "smtp.gmail.com",
    PORT: smtpPort > 0 ? smtpPort : 465,
    USER: process.env.SMTP_USER || "",
    PASS: process.env.SMTP_PASS || "",
    FROM_NAME: process.env.MAIL_FROM_NAME || "SILAB",
  },
};
