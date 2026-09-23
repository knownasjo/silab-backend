const qrPeriodSeconds = Number(process.env.QR_TOKEN_PERIOD_SECONDS);

export const env = {
  JWT: {
    SECRET: process.env.JWT_SECRET || "jwt-secret",
    REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "jwt-refresh-secret",
  },
  QR: {
    PERIOD_SECONDS: qrPeriodSeconds > 0 ? qrPeriodSeconds : 10,
  },
};
