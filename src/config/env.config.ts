export const env = {
  JWT: {
    SECRET: process.env.JWT_SECRET || "jwt-secret",
    REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "jwt-refresh-secret",
  },
};
